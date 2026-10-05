// test/review-step.test.tsx — Review step: the gate, the combo line, and the
// creation submit (spec #133, tickets #131/#145/#146).
//
// Follows test/connect-step.test.tsx: the REAL wizard is rendered and the only
// mocked module is the api-client seam. The whole journey is driven through the
// UI — Basics → Connect → Repositories → Inspection → Review — so the payload
// asserted here is the one a user's clicks produce, and the secret asserted
// here is one the user typed.

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
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectionsProjectInputSchema } from "../src/config-schema.js";
import {
  CONNECTION_STATE_COPY,
  REVIEW_COPY,
  resolveFieldValidationError,
  resolveFormValidationError,
} from "../src/frontend/components/feedback/copy-map.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
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

const GIT_URL = "https://git.example.com";
const GIT_HOST_SECRET = "tok-super-secret-146";
const TRACKER_HOST = "https://tracker.example.com";
// The server-side env key the secret routes to (#131/#145): a name the wizard
// never sees and must therefore never render or persist.
const GIT_HOST_ENV_KEY = "GENERIC_GITHOST_TOKEN";

const MANIFEST: ProviderDescriptor[] = [
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
      },
      {
        name: "token",
        label: "Access Token",
        type: "secret",
        required: true,
        secret: true,
      },
    ],
  },
];

const REPOSITORIES = [
  {
    id: "repo-app",
    name: "rocket-app",
    remote: "https://git.example.com/acme/rocket-app.git",
    defaultBranch: "main",
  },
  {
    id: "repo-api",
    name: "rocket-api",
    remote: "https://git.example.com/acme/rocket-api.git",
    defaultBranch: "main",
  },
];

const IDENTITY = { name: "Repo Owner", email: "owner@example.com" };

// Bun runs the test files of one `bun test` invocation in a single process, so
// a mock assigned onto the api-client module outlives this file. Everything this
// file replaces is restored afterwards, leaving the seam as it was found.
const ORIGINAL_API = {
  getManifest: api.providers.getManifest,
  verify: api.providers.verify,
  parseUrl: api.providers.parseUrl,
  listRepositories: api.providers.listRepositories,
  inspectRepository: api.inspectRepository,
  createProject: api.createProject,
  getProjects: api.getProjects,
};

function restoreApi(): void {
  api.providers.getManifest = ORIGINAL_API.getManifest;
  api.providers.verify = ORIGINAL_API.verify;
  api.providers.parseUrl = ORIGINAL_API.parseUrl;
  api.providers.listRepositories = ORIGINAL_API.listRepositories;
  api.inspectRepository = ORIGINAL_API.inspectRepository;
  api.createProject = ORIGINAL_API.createProject;
  api.getProjects = ORIGINAL_API.getProjects;
}

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

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Renders the projects list the way the app does: through the query cache. */
function ProjectsProbe() {
  const query = useQuery({
    queryKey: queryKeys.projects(),
    queryFn: () => api.getProjects(),
  });
  return (
    <span id="probe-projects">
      {(query.data ?? []).map((project) => project.id).join(",")}
    </span>
  );
}

function Harness() {
  const { openOnboardingModal } = useModal();
  return (
    <div>
      <button type="button" id="btn-open-wizard" onClick={openOnboardingModal}>
        Open Wizard
      </button>
      <ProjectsProbe />
      <WizardModal />
    </div>
  );
}

function renderWizard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(queryKeys.providers(), MANIFEST);
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

/** Drives Basics → Connect with both cards verified, stopping at step 2. */
async function runToConnect() {
  renderWizard();
  fireEvent.click(getEl("btn-open-wizard"));

  await typeInput(getEl("onboard-proj-name"), "Rocket");
  await typeInput(getEl("onboard-proj-description"), "Rocket app");
  await typeInput(getEl("onboard-workspace-path"), "/work/rocket");
  fireEvent.click(getEl("btn-step-1-next"));

  act(() => {
    fireEvent.change(getEl("select-tracker-provider"), {
      target: { value: "generic-tracker" },
    });
    fireEvent.change(getEl("select-gitHost-provider"), {
      target: { value: "generic-githost" },
    });
  });
  await typeInput(getEl("tracker-endpointHost"), TRACKER_HOST);
  await typeInput(getEl("gitHost-gitUrl"), GIT_URL);
  await typeInput(getEl("gitHost-token"), GIT_HOST_SECRET);

  await act(async () => {
    fireEvent.click(getEl("btn-verify-all"));
  });
}

/** Continues from Connect to Repositories, at step 3. */
async function runToRepositories() {
  await runToConnect();
  fireEvent.click(getEl("btn-step-2-next"));
  expect(document.getElementById("onboard-step-3")).not.toBeNull();
  await flush();
}

/** Selects `repoIds` on step 3 and advances to step 4, with the read settled. */
async function runToInspection(repoIds: string[] = ["repo-app"]) {
  await runToRepositories();
  for (const repoId of repoIds) {
    act(() => {
      fireEvent.click(getEl(`repo-select-${repoId}`));
    });
  }
  fireEvent.click(getEl("btn-step-3-next"));
  expect(document.getElementById("onboard-step-4")).not.toBeNull();
  await flush();
}

/** The full journey: at step 5 with everything resolved. */
async function runToReview(repoIds: string[] = ["repo-app"]) {
  await runToInspection(repoIds);
  fireEvent.click(getEl("btn-step-4-next"));
  expect(document.getElementById("onboard-step-5")).not.toBeNull();
  await flush();
}

/**
 * A draft as an interrupted step-5 session leaves it: connections verified in
 * that session, the selection recorded, and the git identity inspected. The
 * secret and the identity never reach storage (asserted by the test itself).
 */
function setupStepFiveDraft(
  overrides: { repositories?: Record<string, unknown> } = {},
) {
  const gitHostConfig = { gitUrl: GIT_URL, token: GIT_HOST_SECRET };
  saveWizardDraft({
    step: 5,
    maxStepVisited: 5,
    basics: {
      name: "Rocket",
      id: "rocket",
      description: "Rocket app",
      workspacePath: "/work/rocket",
    },
    connect: {
      quickUrl: "",
      tracker: {
        providerId: "generic-tracker",
        config: { endpointHost: TRACKER_HOST },
        verified: true,
        degradedAccepted: false,
      },
      gitHost: {
        providerId: "generic-githost",
        config: gitHostConfig,
        verified: true,
        degradedAccepted: false,
      },
    },
    repositories: {
      selectedRepoIds: ["repo-app"],
      primaryRepoId: "repo-app",
      repoConfigs: { "repo-app": { role: "gitHost", roles: ["gitHost"] } },
      selectionFingerprint: connectionConfigFingerprint(
        "generic-githost",
        gitHostConfig,
      ),
      ...(overrides.repositories ?? {}),
    },
    inspection: {
      acknowledged: true,
      gitIdentity: IDENTITY,
      unresolvedRepoIds: [],
      inspectedPath: "/work/rocket",
      inputsFingerprint: "cfp_recorded_before_reload",
    },
    review: { confirmed: true },
  });
}

describe("Review Step: the gate and the creation submit (#146)", () => {
  let createProject: ReturnType<typeof mock>;
  let inspectRepository: ReturnType<typeof mock>;
  let created: Record<string, unknown> | null;

  beforeEach(() => {
    clearWizardDraft();
    created = null;
    api.providers.getManifest = mock(async () => MANIFEST);
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
      repositories: REPOSITORIES,
    }));
    inspectRepository = mock(async (payload: { path: string }) => ({
      path: payload.path,
      exists: true,
      isGitRepo: true,
      gitIdentity: IDENTITY,
      detectedCommands: {},
      detectedTooling: [],
      readiness: { status: "ready" as const, message: "ready" },
    }));
    api.inspectRepository = inspectRepository as never;
    createProject = mock(async (payload: Record<string, unknown>) => {
      created = {
        id: payload.id,
        name: payload.name,
        workspacePath: payload.workspacePath,
        gitIdentity: payload.gitIdentity,
        connections: payload.connections,
        repositories: payload.repositories,
      };
      return created as never;
    });
    api.createProject = createProject as never;
    api.getProjects = mock(async () => (created ? [created] : [])) as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  afterAll(async () => {
    restoreApi();
    await unregisterHappyDom();
  });

  it("SUMMARY: renders the combo line by descriptor name, the project basics, the role-tagged selection and the identity resolved at Inspection", async () => {
    await runToReview(["repo-app", "repo-api"]);

    // The combo line names providers the way the manifest does, never by id.
    expect(getEl("combo-tracker-name").textContent).toBe(
      "Generic Tracker Service",
    );
    expect(getEl("combo-gitHost-name").textContent).toBe(
      "Generic Git Host Service",
    );
    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTION_STATE_COPY.connected,
    );
    expect(getEl("combo-gitHost-state").textContent).toBe(
      CONNECTION_STATE_COPY.connected,
    );
    expect(getEl("combo-summary").textContent).not.toContain("generic-githost");

    expect(getEl("review-proj-name").textContent).toBe("Rocket");
    expect(getEl("review-proj-id").textContent).toBe("rocket");
    expect(getEl("review-workspace-path").textContent).toBe("/work/rocket");
    expect(getEl("review-proj-description").textContent).toBe("Rocket app");

    // Role-tagged selection, with the primary marked.
    expect(getEl("review-repository-repo-app").textContent).toContain(
      "rocket-app",
    );
    expect(getEl("review-repository-repo-app").textContent).toContain(
      "gitHost",
    );
    expect(getEl("review-repository-repo-app-primary")).not.toBeNull();
    expect(getEl("review-repository-repo-api").textContent).toContain(
      "rocket-api",
    );

    // The identity resolved at Inspection is shown again — the same values,
    // and it is NOT re-derived: no extra read happens at Review.
    expect(getEl("review-identity-name").textContent).toBe(IDENTITY.name);
    expect(getEl("review-identity-email").textContent).toBe(IDENTITY.email);
    expect(inspectRepository).toHaveBeenCalledTimes(1);

    // Nothing blocks, and nothing is dismissed either: submit is live.
    expect(document.getElementById("review-blocked")).toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);
  });

  it("BLOCKED ×2: a step-5 draft restores with its verification and identity stripped, so Review refuses to submit and explains why", async () => {
    setupStepFiveDraft();

    // Nothing secret, and no evidence, reaches storage (#131/#145/#146).
    const persisted = window.localStorage.getItem("xf_wizard_draft_v1") ?? "";
    expect(persisted).not.toContain(GIT_HOST_SECRET);
    expect(persisted).not.toContain(GIT_HOST_ENV_KEY);
    expect(persisted).not.toContain(IDENTITY.email);

    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(document.getElementById("onboard-step-5")).not.toBeNull();
    await flush();

    const blocked = getEl("review-blocked");
    expect(blocked.textContent).toContain(REVIEW_COPY.blockedTitle);
    expect(blocked.textContent).toContain(
      REVIEW_COPY.blocked.trackerUnverified,
    );
    expect(blocked.textContent).toContain(
      REVIEW_COPY.blocked.gitHostUnverified,
    );
    expect(blocked.textContent).toContain(
      REVIEW_COPY.blocked.inspectionMissing,
    );
    expect(blocked.textContent).toContain(
      REVIEW_COPY.blocked.identityUnresolved,
    );

    // The identity is gone, so nothing stale is presented as current.
    expect(document.getElementById("review-identity-name")).toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(true);
    // There is no dismissal or skip affordance: back, or submit (disabled).
    expect(
      document.querySelectorAll("#onboard-step-5 .wizard-actions button")
        .length,
    ).toBe(2);
  });

  it("UNBLOCK: re-verifying the connections and re-inspecting the identity clears the block, and the submit travels the #145 payload once", async () => {
    setupStepFiveDraft();
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    expect(document.getElementById("onboard-step-5")).not.toBeNull();
    await flush();
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(true);

    // Back to Connect: the provider selections survive, the secret does not.
    fireEvent.click(getEl("step-nav-connect"));
    expect(document.getElementById("onboard-step-2")).not.toBeNull();
    expect(getEl<HTMLInputElement>("gitHost-gitUrl").value).toBe(GIT_URL);
    expect(getEl<HTMLInputElement>("gitHost-token").value).toBe("");
    await typeInput(getEl("gitHost-token"), GIT_HOST_SECRET);
    await act(async () => {
      fireEvent.click(getEl("btn-verify-all"));
    });

    // The re-entered credential makes the recorded selection current again.
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    await flush();
    expect(document.getElementById("repositories-stale-selection")).toBeNull();
    fireEvent.click(getEl("btn-step-3-next"));

    // Step 4 re-inspects, because a restored draft carries no identity.
    expect(document.getElementById("onboard-step-4")).not.toBeNull();
    await flush();
    expect(getEl("inspection-identity-name").textContent).toBe(IDENTITY.name);
    fireEvent.click(getEl("btn-step-4-next"));
    expect(document.getElementById("onboard-step-5")).not.toBeNull();

    // Unblocked by evidence, not by dismissal — and the identity is shown again.
    expect(document.getElementById("review-blocked")).toBeNull();
    expect(getEl("review-identity-name").textContent).toBe(IDENTITY.name);
    const submit = getEl<HTMLButtonElement>("btn-step-5-submit");
    expect(submit.disabled).toBe(false);

    // The draft on disk still holds no secret; the payload is built from memory.
    expect(
      window.localStorage.getItem("xf_wizard_draft_v1") ?? "",
    ).not.toContain(GIT_HOST_SECRET);

    await act(async () => {
      fireEvent.click(submit);
    });
    await flush();

    expect(createProject).toHaveBeenCalledTimes(1);
    const payload = createProject.mock.calls[0]?.[0] as Record<string, unknown>;
    // Exactly the contract #145 accepts: the payload round-tripped to JSON is
    // what travels on the wire, so undefined role/localPath leave no trace.
    const onTheWire = JSON.parse(JSON.stringify(payload));
    expect(onTheWire).toEqual({
      id: "rocket",
      name: "Rocket",
      description: "Rocket app",
      workspacePath: "/work/rocket",
      gitIdentity: IDENTITY,
      connections: [
        {
          providerId: "generic-tracker",
          roles: ["tracker"],
          config: { endpointHost: TRACKER_HOST },
        },
        {
          providerId: "generic-githost",
          roles: ["gitHost"],
          config: { gitUrl: GIT_URL, token: GIT_HOST_SECRET },
        },
      ],
      repositories: [
        {
          id: "repo-app",
          name: "rocket-app",
          remote: "https://git.example.com/acme/rocket-app.git",
          defaultBranch: "main",
          primary: true,
        },
      ],
    });
    // ...and the server's own schema accepts it (the authority on the shape).
    expect(ConnectionsProjectInputSchema.safeParse(onTheWire).success).toBe(
      true,
    );

    // Success completes the wizard: closed, no re-entry, and the project is
    // visible through the query cache rather than by reloading the page.
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
    expect(getEl("probe-projects").textContent).toBe("rocket");
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();

    // The secret travelled exactly once: in the creation request body. It is in
    // no rendered text, in no draft, and in no other request the wizard made.
    expect(document.body.textContent).not.toContain(GIT_HOST_SECRET);
    expect(document.body.textContent).not.toContain(GIT_HOST_ENV_KEY);
    expect(JSON.stringify(inspectRepository.mock.calls)).not.toContain(
      GIT_HOST_SECRET,
    );
    expect(JSON.stringify(inspectRepository.mock.calls)).not.toContain(
      GIT_HOST_ENV_KEY,
    );
  });

  it("STALE: a workspace root changed after inspection blocks the submit until the identity is resolved again, with no navigation needed", async () => {
    let reads = 0;
    let resolveSecondRead!: (value: unknown) => void;
    const secondRead = new Promise<unknown>((resolve) => {
      resolveSecondRead = resolve;
    });
    inspectRepository = mock(async (payload: { path: string }) => {
      reads += 1;
      if (reads === 1) {
        return {
          path: payload.path,
          exists: true,
          isGitRepo: true,
          gitIdentity: IDENTITY,
          detectedCommands: {},
          detectedTooling: [],
          readiness: { status: "ready", message: "ready" },
        };
      }
      return secondRead;
    });
    api.inspectRepository = inspectRepository as never;

    await runToReview();
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);

    // Move the workspace root, then walk forward again: Connect re-verifies
    // (returning to it resets the in-memory results) and step 4 re-reads.
    fireEvent.click(getEl("step-nav-basics"));
    await typeInput(getEl("onboard-workspace-path"), "/work/moved");
    fireEvent.click(getEl("btn-step-1-next"));
    await act(async () => {
      fireEvent.click(getEl("btn-verify-all"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    await flush();
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();

    // Continue while the re-read is still in flight: the recorded identity
    // belongs to the old inputs, so Review refuses it.
    fireEvent.click(getEl("btn-step-4-next"));
    expect(document.getElementById("onboard-step-5")).not.toBeNull();
    const blocked = getEl("review-blocked");
    expect(blocked.textContent).toContain(REVIEW_COPY.blocked.inspectionStale);
    // The identity is not presented as current while it is out of date.
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(true);
    expect(inspectRepository).toHaveBeenLastCalledWith({ path: "/work/moved" });

    // The read lands: the gate opens on its own, without re-entering anything.
    await act(async () => {
      resolveSecondRead({
        path: "/work/moved",
        exists: true,
        isGitRepo: true,
        gitIdentity: { name: "Moved Owner", email: "moved@example.com" },
        detectedCommands: {},
        detectedTooling: [],
        readiness: { status: "ready", message: "ready" },
      });
    });
    await flush();

    expect(document.getElementById("review-blocked")).toBeNull();
    expect(getEl("review-identity-name").textContent).toBe("Moved Owner");
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);
  });

  it("DEGRADED: a verified connection with warnings is shown as degraded, blocks Review until the warnings are accepted, and then submits", async () => {
    api.providers.verify = mock(async (payload: { role: string }) =>
      payload.role === "tracker"
        ? {
            status: "degraded" as const,
            warnings: [
              {
                kind: "CAPABILITY_UNCONFIRMED" as const,
                capability: "listTickets",
              },
            ],
          }
        : { status: "ok" as const, warnings: [] },
    );

    await runToConnect();
    // The tracker degraded: recorded, and visible as such on the card...
    expect(getEl("connection-card-tracker").textContent).toContain("Degraded");
    // ...and it is not usable until the warnings are accepted, so Connect
    // itself refuses to move on.
    expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(true);
    await act(async () => {
      fireEvent.click(getEl("btn-accept-degraded-tracker"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    await flush();

    // The combo line reports the SAME state as the gate.
    fireEvent.click(getEl("repo-select-repo-app"));
    fireEvent.click(getEl("btn-step-3-next"));
    await flush();
    fireEvent.click(getEl("btn-step-4-next"));
    await flush();
    expect(document.getElementById("onboard-step-5")).not.toBeNull();
    expect(getEl("combo-tracker-state").textContent).toBe(
      CONNECTION_STATE_COPY.degradedAccepted,
    );
    expect(getEl("combo-tracker-state").dataset.connectionState).toBe("degraded");
    // Accepted evidence — not a dismissal — is what unblocked it.
    expect(document.getElementById("review-blocked")).toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);
  });

  it("PENDING: the submit is disabled and busy while the request is in flight, and every entered value is still on screen", async () => {
    let resolveCreate!: (value: unknown) => void;
    createProject = mock(
      async () =>
        new Promise<unknown>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    api.createProject = createProject as never;
    await runToReview();

    const submit = getEl<HTMLButtonElement>("btn-step-5-submit");
    const nameNode = getEl("review-proj-name");
    await act(async () => {
      fireEvent.click(submit);
    });
    await flush();

    expect(createProject).toHaveBeenCalledTimes(1);
    expect(submit.disabled).toBe(true);
    expect(submit.textContent).toBe(REVIEW_COPY.submitting);
    // Nothing was lost and nothing was remounted.
    expect(getEl("review-proj-name")).toBe(nameNode);
    expect(getEl("review-proj-name").textContent).toBe("Rocket");
    expect(getEl("review-identity-name").textContent).toBe(IDENTITY.name);
    expect(getEl("combo-gitHost-name").textContent).toBe(
      "Generic Git Host Service",
    );
    expect(document.getElementById("review-submit-error")).toBeNull();

    await act(async () => {
      resolveCreate({ id: "rocket", name: "Rocket" });
    });
    await flush();
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
  });

  it("SEMANTIC 409: the envelope's form and field codes render as canonical copy, the entered data survives, and the retry works without a remount", async () => {
    let attempts = 0;
    createProject = mock(async (payload: Record<string, unknown>) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError("Conflict", 409, {
          formErrors: ["INCOMPATIBLE_CONFIGURATION"],
          fieldErrors: { token: "INVALID" },
        });
      }
      created = { id: payload.id, name: payload.name };
      return created as never;
    });
    api.createProject = createProject as never;

    await runToReview();
    const nameNode = getEl("review-proj-name");
    await act(async () => {
      fireEvent.click(getEl("btn-step-5-submit"));
    });
    await flush();

    const banner = getEl("review-submit-error");
    expect(banner.textContent).toContain(REVIEW_COPY.conflictTitle);
    expect(banner.textContent).toContain(
      resolveFormValidationError("INCOMPATIBLE_CONFIGURATION"),
    );
    // The field is named the way the manifest names it, never by its key, and
    // the code itself is never rendered.
    expect(banner.textContent).toContain(
      resolveFieldValidationError("INVALID", "Access Token"),
    );
    expect(banner.textContent).not.toContain("INVALID");
    expect(banner.textContent).not.toContain("token is invalid");

    // Entered work is preserved and nothing was remounted.
    expect(getEl("review-proj-name")).toBe(nameNode);
    expect(getEl("review-proj-name").textContent).toBe("Rocket");
    expect(getEl("review-identity-name").textContent).toBe(IDENTITY.name);
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);

    // The offered retry is a real recovery, in place.
    await act(async () => {
      fireEvent.click(
        banner.querySelector(".retry-action") as HTMLButtonElement,
      );
    });
    await flush();
    expect(createProject).toHaveBeenCalledTimes(2);
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
    expect(getEl("probe-projects").textContent).toBe("rocket");
  });

  it("TRANSPORT 400: a refused request renders canonical copy, never the server's message, and keeps the work", async () => {
    let attempts = 0;
    createProject = mock(async (payload: Record<string, unknown>) => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError("Invalid JSON for project creation.", 400, {
          error: "Invalid JSON for project creation.",
        });
      }
      created = { id: payload.id, name: payload.name };
      return created as never;
    });
    api.createProject = createProject as never;

    await runToReview();
    await act(async () => {
      fireEvent.click(getEl("btn-step-5-submit"));
    });
    await flush();

    const banner = getEl("review-submit-error");
    expect(banner.textContent).toContain(REVIEW_COPY.requestRejectedTitle);
    expect(banner.textContent).toContain(REVIEW_COPY.requestRejectedDetail);
    expect(banner.textContent).not.toContain(
      "Invalid JSON for project creation",
    );
    // Still enterable, still retryable, nothing lost.
    expect(getEl("review-proj-name").textContent).toBe("Rocket");
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);

    await act(async () => {
      fireEvent.click(getEl("btn-step-5-submit"));
    });
    await flush();
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
  });

  it("NETWORK ERROR: a request that never reached the server says so, offers a retry, and loses nothing", async () => {
    let attempts = 0;
    createProject = mock(async (payload: Record<string, unknown>) => {
      attempts += 1;
      if (attempts === 1) {
        throw new TypeError("Failed to fetch");
      }
      created = { id: payload.id, name: payload.name };
      return created as never;
    });
    api.createProject = createProject as never;

    await runToReview();
    const nameNode = getEl("review-proj-name");
    await act(async () => {
      fireEvent.click(getEl("btn-step-5-submit"));
    });
    await flush();

    const banner = getEl("review-submit-error");
    expect(banner.textContent).toContain(REVIEW_COPY.networkErrorTitle);
    expect(banner.textContent).toContain(REVIEW_COPY.networkErrorDetail);
    expect(banner.textContent).not.toContain("Failed to fetch");
    expect(getEl("review-proj-name")).toBe(nameNode);
    expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);

    await act(async () => {
      fireEvent.click(getEl("btn-step-5-submit"));
    });
    await flush();
    expect(createProject).toHaveBeenCalledTimes(2);
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
  });
});
