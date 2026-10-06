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
import { connectionConfigFingerprint } from "../src/frontend/lib/connection-fingerprint.js";
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

/**
 * A completed Repositories-step selection for the `generic-githost` connection
 * with an empty config — the state a finished step 3 leaves behind. Navigation
 * tests need it because step 3 refuses to advance without one (#144).
 */
const REPOSITORIES_WITH_SELECTION = {
  selectedRepoIds: ["repo-1"],
  primaryRepoId: "repo-1",
  repoConfigs: { "repo-1": { role: "gitHost", roles: ["gitHost"] } },
  selectionFingerprint: connectionConfigFingerprint("generic-githost", {}),
};

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

/**
 * Renders the harness. `manifestData === null` leaves the manifest cache empty,
 * so the step has to fetch it — the read region's own states.
 */
function renderWizard(
  manifestData: ProviderDescriptor[] | null = genericManifestFixture,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  if (manifestData !== null) {
    queryClient.setQueryData(queryKeys.providers(), manifestData);
  }

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
      providerConfigs: {},
      tracker: {
        providerId: null,
        verified: false,
      },
      gitHost: {
        providerId: null,
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
    api.providers.listRepositories = mock(async () => ({
      providerId: "generic-githost",
      roles: ["gitHost"],
      repositories: [
        {
          id: "repo-1",
          name: "rocket-app",
          remote: "https://git.example.com/acme/rocket-app.git",
        },
      ],
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

  // Correction 2 (#133): the two roles' configurations are NOT independent when
  // they name the same provider — that independence was the defect (each card
  // could verify its own configuration while only one of them was submitted).
  // One provider has ONE configuration: a value typed on either card is the
  // value both cards show, and both roles' verification corresponds to it.
  // Isolation still holds between DIFFERENT providers, which is what the second
  // half of this test pins.
  it("STATE ISOLATION: one provider serving both roles shares ONE configuration, while different providers stay independent", async () => {
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

    // Git-host's serviceUrl shows the SAME configuration: the provider has one,
    // and this is what both roles verify and what the payload carries.
    const gitHostUrlInput = getEl<HTMLInputElement>("gitHost-serviceUrl");
    expect(gitHostUrlInput.value).toBe("https://tracker-only.com");

    // Change git-host's pat
    const gitHostPatInput = getEl<HTMLInputElement>("gitHost-pat");
    await typeInput(gitHostPatInput, "git-pat-secret");

    // Tracker's pat shows that same value: one configuration, whichever card
    // wrote it.
    const trackerPatInput = getEl<HTMLInputElement>("tracker-pat");
    expect(trackerPatInput.value).toBe("git-pat-secret");

    // The state holds ONE configuration for the one provider both roles name,
    // never a copy per role — asserted at the state level in
    // `test/wizard-reducer.test.ts` ("one configuration per provider").

    // DIFFERENT providers are still independent: point the git-host card at
    // another provider and edit each side — neither provider's configuration
    // moves the other's.
    act(() => {
      fireEvent.change(getEl("select-gitHost-provider"), {
        target: { value: "generic-githost" },
      });
    });
    await typeInput(
      getEl<HTMLInputElement>("tracker-serviceUrl"),
      "https://t2",
    );
    await typeInput(getEl<HTMLInputElement>("gitHost-gitUrl"), "https://g2");

    expect(getEl<HTMLInputElement>("tracker-serviceUrl").value).toBe(
      "https://t2",
    );
    expect(getEl<HTMLInputElement>("gitHost-gitUrl").value).toBe("https://g2");
  });

  it("NAVIGATION GATING: Next is blocked with a missing selection or an unverified connection, and enabled as soon as both are verified — degraded included (#133)", async () => {
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

    // 3. Degraded connection -> verified, so the partial state is shown and
    // progression is NEVER blocked (#133: "degraded renders the partial state,
    // never blocks progression").
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

    // Tracker is ok, GitHost is degraded -> the partial state is on the card...
    const gitHostCard = getEl("connection-card-gitHost");
    expect(gitHostCard.textContent).toContain("Degraded");
    expect(gitHostCard.textContent).toContain(STATE_COPY.partial);

    // ...and Next is ENABLED: there is no acknowledgement to collect.
    expect(document.getElementById("btn-accept-degraded-gitHost")).toBeNull();
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

  // ══ CORRECTION 2 (#133): one provider, ONE verified configuration ═══════════
  //
  // A single provider serving both roles used to be configurable (and
  // verifiable) TWICE, once per card, while the payload submitted only one of
  // the two copies. These tests drive the real wizard to pin the corrected
  // behaviour: the cards are views of the provider's one configuration, both
  // verifications carry it, and an edit from either card invalidates both.
  describe("SAME PROVIDER FOR BOTH ROLES: one configuration, verified as one", () => {
    it("both roles verify the SAME configuration, and it is the configuration on record", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "dual-service" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "dual-service" },
        });
      });

      // The user fills the tracker card, then the git-host card. Both cards are
      // views of the ONE configuration of the provider they both selected.
      await typeInput(
        getEl<HTMLInputElement>("tracker-serviceUrl"),
        "https://typed.example.com",
      );
      await typeInput(getEl<HTMLInputElement>("gitHost-pat"), "pat-synthetic");

      expect(getEl<HTMLInputElement>("tracker-serviceUrl").value).toBe(
        "https://typed.example.com",
      );
      expect(getEl<HTMLInputElement>("gitHost-serviceUrl").value).toBe(
        "https://typed.example.com",
      );
      expect(getEl<HTMLInputElement>("gitHost-pat").value).toBe(
        "pat-synthetic",
      );
      expect(getEl<HTMLInputElement>("tracker-pat").value).toBe(
        "pat-synthetic",
      );

      const verifyMock = mock(
        async (_payload: {
          providerId: string;
          role: string;
          config: Record<string, unknown>;
        }) => ({ status: "ok" as const, warnings: [] }),
      );
      api.providers.verify = verifyMock;

      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });

      expect(verifyMock).toHaveBeenCalledTimes(2);
      const trackerCall = verifyMock.mock.calls.find(
        (call) => call[0]?.role === "tracker",
      )?.[0];
      const gitHostCall = verifyMock.mock.calls.find(
        (call) => call[0]?.role === "gitHost",
      )?.[0];
      expect(trackerCall?.providerId).toBe("dual-service");
      expect(gitHostCall?.providerId).toBe("dual-service");

      // THE assertion of correction 2: the two roles verified the SAME
      // configuration. Before the fix each card carried its own copy, so the
      // tracker was verified against a configuration nobody submitted.
      expect(trackerCall?.config).toEqual(gitHostCall?.config);
      expect(trackerCall?.config).toEqual({
        serviceUrl: "https://typed.example.com",
        pat: "pat-synthetic",
      });

      // ...and that is exactly the configuration the payload carries:
      // `buildCreationPayload` reads this same provider record from state, and
      // `test/review-payload.test.ts` asserts it is the SAME object, not a copy
      // of one role's view of it.
      expect(getEl("connection-card-tracker").textContent).toContain(
        "Verified",
      );
      expect(getEl("connection-card-gitHost").textContent).toContain(
        "Verified",
      );
    });

    it("editing the shared configuration from EITHER card invalidates BOTH roles' verification", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "dual-service" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "dual-service" },
        });
      });
      await typeInput(
        getEl<HTMLInputElement>("tracker-serviceUrl"),
        "https://a.example.com",
      );
      await typeInput(getEl<HTMLInputElement>("gitHost-pat"), "pat-1");

      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(false);

      // Edited from the GIT HOST card: the tracker's verification of the same
      // configuration goes with it — there is only one configuration.
      await typeInput(getEl<HTMLInputElement>("gitHost-pat"), "pat-2");
      expect(getEl("connection-card-tracker").textContent).not.toContain(
        "Verified",
      );
      expect(getEl("connection-card-gitHost").textContent).not.toContain(
        "Verified",
      );
      expect(nextBtn.disabled).toBe(true);

      // Re-verify, then edit from the TRACKER card: the same, in the other
      // direction.
      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });
      expect(nextBtn.disabled).toBe(false);

      await typeInput(
        getEl<HTMLInputElement>("tracker-serviceUrl"),
        "https://b.example.com",
      );
      expect(getEl("connection-card-tracker").textContent).not.toContain(
        "Verified",
      );
      expect(getEl("connection-card-gitHost").textContent).not.toContain(
        "Verified",
      );
      expect(nextBtn.disabled).toBe(true);
    });

    it("a provider the manifest does not declare for a role is never presented as dual-role", () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
      });

      // The manifest declares `roles: ["tracker"]` for it: no dual-role badge,
      // and the git-host card does not offer it at all. A connection can
      // therefore never claim the gitHost role on its behalf — the payload's
      // roles come from the two role selections, and the second selection
      // cannot name it (pinned for the payload in `test/review-payload.test.ts`).
      expect(getEl("connection-card-tracker").textContent).not.toContain(
        "Dual-role",
      );
      const gitHostOptions = Array.from(
        getEl<HTMLSelectElement>("select-gitHost-provider").options,
      ).map((option) => option.value);
      expect(gitHostOptions).not.toContain("generic-tracker");
      expect(gitHostOptions).toContain("dual-service");
    });
  });

  describe("DEGRADED CONNECTIONS & NAVIGATION (ticket #143 §5, §8; spec #133)", () => {
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

    it("(b) ideal + degraded permits continuation, shows the partial state, and collects no acknowledgement", async () => {
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

      // The partial state is rendered, naming the unconfirmed capability.
      const gitHostCard = getEl("connection-card-gitHost");
      expect(gitHostCard.textContent).toContain("Degraded");
      expect(gitHostCard.textContent).toContain(STATE_COPY.partial);
      expect(gitHostCard.textContent).toContain("createPullRequest");

      // Tracker is ideal (ok), GitHost is degraded -> permitted: no gate.
      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(false);
      expect(document.getElementById("btn-accept-degraded-gitHost")).toBeNull();
    });

    it("(c) an errored connection still blocks continuation", async () => {
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
        return { code: "AUTH_INVALID" as const, context: "VERIFY" as const };
      });

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      // A rejected credential is not a partial state: it is not verified.
      expect(getEl("connection-card-gitHost").textContent).toContain("Error");
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);
    });

    it("(d) both roles degraded permits continuation, and each card carries its own partial state", async () => {
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

      for (const role of ["tracker", "gitHost"]) {
        const card = getEl(`connection-card-${role}`);
        expect(card.textContent).toContain("Degraded");
        expect(card.textContent).toContain("someCapability");
      }

      const nextBtn = getEl<HTMLButtonElement>("btn-step-2-next");
      expect(nextBtn.disabled).toBe(false);

      // And the flow really continues with both roles degraded.
      await act(async () => {
        fireEvent.click(nextBtn);
      });
      expect(document.getElementById("onboard-step-3")).not.toBeNull();
    });

    it("editing a role's config invalidates its verification without touching the other role", async () => {
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
      expect(nextBtn.disabled).toBe(false);

      // Edit tracker config field: what was verified is no longer current.
      const trackerEndpointInput = getEl<HTMLInputElement>(
        "tracker-endpointHost",
      );
      await typeInput(trackerEndpointInput, "https://tracker-changed.com");

      // The tracker's verification is RESET, so Next blocks again...
      expect(nextBtn.disabled).toBe(true);
      expect(getEl("connection-card-tracker").textContent).not.toContain(
        "Degraded",
      );

      // ...and the gitHost's partial state is untouched.
      expect(getEl("connection-card-gitHost").textContent).toContain(
        "Degraded",
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

  describe("StepNav Regression Tests", () => {
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

    it("Verified connection becomes invalid", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Select and verify both to enable Next
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });
      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      // Advance to Repositories
      fireEvent.click(getEl("btn-step-2-next"));
      expect(document.getElementById("onboard-step-3")).not.toBeNull();

      // Return to Connect
      fireEvent.click(getEl("step-nav-connect"));
      expect(document.getElementById("onboard-step-2")).not.toBeNull();

      // Change a provider config field
      const endpointInput = getEl<HTMLInputElement>("tracker-endpointHost");
      await typeInput(endpointInput, "https://changed.example.com");

      // Verify StepNav cannot navigate to Repositories
      const repoBtn = getEl<HTMLButtonElement>("step-nav-repositories");
      expect(repoBtn.disabled).toBe(true);

      // Verify Connect Next remains blocked
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);
    });

    it("Degraded verification becomes invalid when the provider changes", async () => {
      setupStep2Draft();
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Select tracker and verify degraded
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
          return {
            status: "degraded" as const,
            warnings: [
              {
                kind: "CAPABILITY_UNCONFIRMED" as const,
                capability: "listTickets",
              },
            ],
          };
        }
        return { status: "ok" as const, warnings: [] };
      });

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });

      // The degraded verification alone permits continuation (#133).
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(false);

      // Advance to Repositories
      fireEvent.click(getEl("btn-step-2-next"));
      expect(document.getElementById("onboard-step-3")).not.toBeNull();

      // Return to Connect
      fireEvent.click(getEl("step-nav-connect"));
      expect(document.getElementById("onboard-step-2")).not.toBeNull();

      // Change provider
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "dual-service" },
        });
      });

      // The degraded evidence belonged to the previous provider: it is gone, so
      // Next blocks until the new provider is verified.
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);

      // Confirm StepNav cannot navigate to Repositories
      const repoBtn = getEl<HTMLButtonElement>("step-nav-repositories");
      expect(repoBtn.disabled).toBe(true);
    });

    it("Backward navigation still works", async () => {
      setupStep2Draft({ repositories: REPOSITORIES_WITH_SELECTION });
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Advance to Repositories
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });
      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });
      fireEvent.click(getEl("btn-step-2-next"));
      expect(document.getElementById("onboard-step-3")).not.toBeNull();

      // Advance to step 4
      fireEvent.click(getEl("btn-step-3-next"));
      expect(document.getElementById("onboard-step-4")).not.toBeNull();

      // Ensure we can go back to Step 2 and Step 1 from Step 4
      const step2Btn = getEl<HTMLButtonElement>("step-nav-connect");
      expect(step2Btn.disabled).toBe(false);

      fireEvent.click(step2Btn);
      expect(document.getElementById("onboard-step-2")).not.toBeNull();

      const step1Btn = getEl<HTMLButtonElement>("step-nav-basics");
      expect(step1Btn.disabled).toBe(false);

      fireEvent.click(step1Btn);
      expect(document.getElementById("onboard-step-1")).not.toBeNull();
    });

    it("Previously visited forward step is not directly reachable", async () => {
      setupStep2Draft({ repositories: REPOSITORIES_WITH_SELECTION });
      renderWizard();
      fireEvent.click(getEl("btn-open-wizard"));

      // Set maxStepVisited to 4 by advancing
      act(() => {
        fireEvent.change(getEl("select-tracker-provider"), {
          target: { value: "generic-tracker" },
        });
        fireEvent.change(getEl("select-gitHost-provider"), {
          target: { value: "generic-githost" },
        });
      });
      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
        fireEvent.click(getEl("btn-verify-gitHost"));
      });
      fireEvent.click(getEl("btn-step-2-next")); // To Step 3
      fireEvent.click(getEl("btn-step-3-next")); // To Step 4
      expect(document.getElementById("onboard-step-4")).not.toBeNull();

      // Go back to Step 2
      fireEvent.click(getEl("step-nav-connect"));
      expect(document.getElementById("onboard-step-2")).not.toBeNull();

      // Try to jump forward to Step 3 or 4 using StepNav
      const step3Btn = getEl<HTMLButtonElement>("step-nav-repositories");
      const step4Btn = getEl<HTMLButtonElement>("step-nav-inspection");

      expect(step3Btn.disabled).toBe(true);
      expect(step4Btn.disabled).toBe(true);

      // MaxStepVisited semantics remain the same (still 4 in local storage or state)
      const raw = window.localStorage.getItem("xf_wizard_draft_v1");
      const parsed = JSON.parse(raw || "{}");
      expect(parsed.state.maxStepVisited).toBe(4);
    });
  });

  // ── Smoothness #1 (#148): verification completion stays local to its card ──
  //
  // The criterion is "no full modal re-render on verification completion".
  // What a user can actually observe is a REMOUNT: nodes are replaced, the
  // other card's entered values and focus are rebuilt from scratch, and the
  // step flashes. That is what these assertions detect — a MutationObserver
  // over the step reports which regions were structurally rebuilt, and node
  // identity proves the rest was not. A pure re-render that produces identical
  // DOM is invisible to the user by definition; it is not what this detects and
  // is not claimed.
  describe("Smoothness #1: verifying one role stays local to its card (#148)", () => {
    it("SMOOTHNESS #1: completing one role's verification rebuilds only that card — the other card, its entered values and the step are untouched", async () => {
      let resolveTracker!: (value: VerificationResult) => void;
      const verify = mock(
        (payload: {
          providerId: string;
          role: string;
          config: Record<string, unknown>;
        }) =>
          payload.role === "tracker"
            ? new Promise<VerificationResult>((resolve) => {
                resolveTracker = resolve;
              })
            : Promise.resolve({ status: "ok" as const, warnings: [] }),
      );
      api.providers.verify = verify as never;

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
      await typeInput(
        getEl("tracker-endpointHost"),
        "https://tracker.example.com",
      );
      await typeInput(getEl("gitHost-gitUrl"), "https://git.example.com");
      await typeInput(getEl("gitHost-token"), "tok-plaintext-secret");

      const step = getEl("onboard-step-2");
      const verifiedCard = getEl("connection-card-tracker");
      const otherCard = getEl("connection-card-gitHost");
      const otherInput = getEl<HTMLInputElement>("gitHost-gitUrl");
      const otherSelect = getEl<HTMLSelectElement>("select-gitHost-provider");
      const verifyAllRow = step.querySelector(
        ".connect-verify-all-row",
      ) as HTMLElement;

      // Only structural churn matters: a replaced node is a remount.
      const structural: MutationRecord[] = [];
      const observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "childList") structural.push(record);
        }
      });
      observer.observe(step, { childList: true, subtree: true });

      await act(async () => {
        fireEvent.click(getEl("btn-verify-tracker"));
      });
      await act(async () => {
        resolveTracker({ status: "ok", warnings: [] });
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      observer.disconnect();

      // The verified role reports its outcome.
      expect(verifiedCard.dataset.role).toBe("tracker");
      expect(getEl("connection-card-tracker").textContent).toContain(
        "Verified",
      );

      // Nothing outside the card whose evidence changed (and the verify-all row
      // that reports the batch) was structurally rebuilt: no remount of the
      // other card, no remount of the step.
      const rebuilt = structural.map((record) => record.target);
      expect(
        rebuilt.every(
          (target) =>
            verifiedCard.contains(target) || verifyAllRow.contains(target),
        ),
      ).toBe(true);

      // Node identity: the step, the other card, and the other card's field and
      // select are the very same nodes as before the verification completed.
      expect(getEl("onboard-step-2")).toBe(step);
      expect(getEl("connection-card-tracker")).toBe(verifiedCard);
      expect(getEl("connection-card-gitHost")).toBe(otherCard);
      expect(getEl("gitHost-gitUrl")).toBe(otherInput);
      expect(getEl("select-gitHost-provider")).toBe(otherSelect);

      // And the other card's work is intact — not re-entered, not lost.
      expect(getEl<HTMLInputElement>("gitHost-gitUrl").value).toBe(
        "https://git.example.com",
      );
      expect(getEl<HTMLInputElement>("gitHost-token").value).toBe(
        "tok-plaintext-secret",
      );

      // The other role was never verified on the back of this one.
      expect(verify).toHaveBeenCalledTimes(1);
      expect(verify.mock.calls[0]?.[0]).toEqual({
        providerId: "generic-tracker",
        role: "tracker",
        config: { endpointHost: "https://tracker.example.com" },
      });
    });
  });

  // ── Connect's own read region: the provider manifest (#148 audit) ──────────
  //
  // The contract (docs/reference/state-coverage.md) requires every read region
  // to be tested in its states. The Connect step's manifest region is asserted
  // here: loading (in flight), error (unavailable, with a working retry), and
  // empty (no provider registered — the step still renders, nothing selected).
  describe("Connect — the provider manifest read region (#148)", () => {
    /** The manifest read is a query: its state lands a tick after it settles. */
    async function flushManifest(): Promise<void> {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }

    it("LOADING: the step reserves its region while the manifest is in flight, and the cards land in the same step", async () => {
      let resolveManifest!: (value: ProviderDescriptor[]) => void;
      const getManifest = mock(
        () =>
          new Promise<ProviderDescriptor[]>((resolve) => {
            resolveManifest = resolve;
          }),
      );
      api.providers.getManifest = getManifest as never;

      setupStep2Draft();
      renderWizard(null);
      fireEvent.click(getEl("btn-open-wizard"));

      const step = getEl("onboard-step-2");
      const loading = step.querySelector(".async-region--loading");
      expect(loading).not.toBeNull();
      expect(loading?.getAttribute("role")).toBe("status");
      expect(getManifest).toHaveBeenCalledTimes(1);
      // Nothing to configure yet: the cards are not rendered behind the region.
      expect(document.getElementById("connection-card-tracker")).toBeNull();

      await act(async () => {
        resolveManifest(genericManifestFixture);
      });
      await flushManifest();

      // Same step element, and the provider choices are the manifest's.
      expect(getEl("onboard-step-2")).toBe(step);
      const options = [
        ...getEl<HTMLSelectElement>("select-tracker-provider").options,
      ]
        .map((option) => option.value)
        .filter((value) => value !== "");
      expect(options).toEqual(["generic-tracker", "dual-service"]);
      expect(getManifest).toHaveBeenCalledTimes(1);
    });

    it("ERROR: an unavailable manifest renders canonical copy with a working retry, never the transport message", async () => {
      let attempts = 0;
      const getManifest = mock(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new TypeError("Failed to fetch");
        }
        return genericManifestFixture;
      });
      api.providers.getManifest = getManifest as never;

      setupStep2Draft();
      renderWizard(null);
      fireEvent.click(getEl("btn-open-wizard"));
      await flushManifest();

      const step = getEl("onboard-step-2");
      const errorRegion = step.querySelector(".async-region--error");
      expect(errorRegion).not.toBeNull();
      expect(errorRegion?.textContent).toContain(STATE_COPY.errorFallback);
      expect(errorRegion?.textContent).not.toContain("Failed to fetch");

      // The retry re-invokes the read in place: same step, cards now present.
      const retry = errorRegion?.querySelector(
        ".retry-action",
      ) as HTMLButtonElement;
      expect(retry.textContent).toContain(STATE_COPY.retry);
      await act(async () => {
        fireEvent.click(retry);
      });
      await flushManifest();
      expect(getManifest).toHaveBeenCalledTimes(2);
      expect(getEl("onboard-step-2")).toBe(step);
      expect(document.getElementById("connection-card-tracker")).not.toBeNull();
    });

    it("EMPTY: a registry with no providers renders the step, preselects nothing, and keeps the gate closed", async () => {
      setupStep2Draft();
      renderWizard([]);
      fireEvent.click(getEl("btn-open-wizard"));

      // The step is not blank and not an error: both cards are there, with no
      // provider to choose.
      expect(document.getElementById("connection-card-tracker")).not.toBeNull();
      expect(getEl<HTMLSelectElement>("select-tracker-provider").value).toBe(
        "",
      );
      expect(getEl<HTMLSelectElement>("select-gitHost-provider").value).toBe(
        "",
      );
      expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);
      expect(
        document
          .getElementById("onboard-step-2")
          ?.querySelector(".async-region--error"),
      ).toBeNull();
    });
  });
});
