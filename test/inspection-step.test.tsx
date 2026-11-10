// test/inspection-step.test.tsx — Inspection step: the git identity the agent
// commits with (spec #133, ticket #146).
//
// Follows test/repositories-step.test.tsx: the REAL wizard is rendered and the
// only mocked module is the api-client seam. Every read-region state is
// asserted through the feedback primitives, and no test reaches into a hook or
// child component.

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
  INSPECTION_COPY,
  STATE_COPY,
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
import type {
  WizardInspectionState,
  WizardRepoConfig,
} from "../src/frontend/wizard/types.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";

const MANIFEST: ProviderDescriptor[] = [
  {
    id: "generic-tracker",
    displayName: "Generic Tracker Service",
    roles: ["tracker"],
    iconRef: "icon-custom-tracker",
    capabilities: ["listTickets"],
    configFields: [],
  },
  {
    id: "generic-githost",
    displayName: "Generic Git Host Service",
    roles: ["gitHost"],
    iconRef: "icon-custom-git",
    capabilities: ["listRepositories", "createPullRequest"],
    configFields: [
      { name: "gitUrl", label: "Git URL", type: "url", required: true },
    ],
  },
];

const GIT_HOST_CONFIG = { gitUrl: "https://git.example.com" };
const WORKSPACE = "/work/rocket";

const DISCOVERED_REPOSITORIES = [
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

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
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

interface StepFourDraftOptions {
  workspacePath?: string;
  selectedRepoIds?: string[];
  repoConfigs?: Record<string, WizardRepoConfig>;
  inspection?: Partial<WizardInspectionState>;
}

function setupStepFourDraft(options: StepFourDraftOptions = {}) {
  const selectedRepoIds = options.selectedRepoIds ?? ["repo-app"];
  saveWizardDraft(
    {
      step: 4,
      maxStepVisited: 4,
      basics: {
        name: "Rocket",
        id: "rocket",
        description: "",
        workspacePath: options.workspacePath ?? WORKSPACE,
      },
      connect: {
        // Step 1's repository URL (#268): present, so returning to step 1 and
        // continuing still validates.
        quickUrl: "https://git.example.com/acme/rocket",
        providerConfigs: {
          "generic-tracker": {},
          "generic-githost": GIT_HOST_CONFIG,
        },
        tracker: { providerId: "generic-tracker", verified: true },
        gitHost: { providerId: "generic-githost", verified: true },
      },
      repositories: {
        selectedRepoIds,
        primaryRepoId: selectedRepoIds[0] ?? null,
        repoConfigs: options.repoConfigs ?? {
          "repo-app": { role: "gitHost", roles: ["gitHost"] },
        },
        selectionFingerprint:
          selectedRepoIds.length > 0
            ? connectionConfigFingerprint(
                "generic-githost",
                GIT_HOST_CONFIG,
                MANIFEST,
              )
            : null,
      },
      inspection: { acknowledged: false, ...(options.inspection ?? {}) },
      review: { confirmed: false },
    },
    MANIFEST,
  );
}

/** Flushes the inspection (and discovery) fetch → render cycle. */
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function typeInput(input: HTMLElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyUp(input);
  });
}

/**
 * Leaves a field the way the browser does. Not `fireEvent.blur`: happy-dom's
 * synthetic blur leaves React's change bookkeeping for that node broken, so the
 * next keystroke never reaches `onChange`.
 */
function leaveInput(input: HTMLElement) {
  act(() => {
    input.blur();
  });
}

function nameValue(): string {
  return getEl<HTMLInputElement>("git-identity-name-input").value;
}

function emailValue(): string {
  return getEl<HTMLInputElement>("git-identity-email-input").value;
}

function inspectionResponse(
  path: string,
  identity?: { name: string; email: string },
) {
  return {
    path,
    exists: true,
    isGitRepo: true,
    isRepositoryRoot: true,
    ...(identity ? { gitIdentity: identity } : {}),
    detectedCommands: {},
    detectedTooling: [],
    readiness: { status: "ready", message: "ready" },
  };
}

/** The region the step reserves for the inspection read. */
function inspectionRegion(): HTMLElement {
  return getEl("inspection-region");
}

function openInspectionStep(options: StepFourDraftOptions = {}) {
  setupStepFourDraft(options);
  renderWizard();
  fireEvent.click(getEl("btn-open-wizard"));
  expect(document.getElementById("onboard-step-4")).not.toBeNull();
}

describe("Inspection Step: the git identity the agent commits with (#146)", () => {
  let inspectRepository: ReturnType<typeof mock>;

  beforeEach(() => {
    clearWizardDraft();
    api.providers.getManifest = mock(async () => MANIFEST);
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
      providerId: "generic-githost",
      roles: ["gitHost"],
      repositories: DISCOVERED_REPOSITORIES,
    }));
    inspectRepository = mock(async () => ({
      path: WORKSPACE,
      exists: true,
      isGitRepo: true,
      gitIdentity: IDENTITY,
      detectedCommands: {},
      detectedTooling: [],
      readiness: { status: "ready" as const, message: "ready" },
    }));
    api.inspectRepository = inspectRepository as never;
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("LOADING: an indeterminate spinner fills the reserved region, and the fields land in the same region (no layout shift)", async () => {
    let resolveInspection!: (value: unknown) => void;
    const deferred = new Promise<unknown>((resolve) => {
      resolveInspection = resolve;
    });
    inspectRepository = mock(async () => deferred);
    api.inspectRepository = inspectRepository as never;

    openInspectionStep();

    const region = inspectionRegion();
    const loading = region.querySelector(".async-region--loading");
    expect(loading).not.toBeNull();
    const waiting = loading?.querySelector('[role="status"]');
    expect(waiting).not.toBeNull();
    expect(waiting?.textContent).toContain("Loading…");
    expect(loading?.querySelector("use")?.getAttribute("href")).toContain(
      "icon-loader-2",
    );
    expect(document.getElementById("git-identity-name-input")).toBeNull();

    // The read is scoped to the directory the executor's worktree is created in.
    expect(inspectRepository).toHaveBeenCalledTimes(1);
    expect(inspectRepository.mock.calls[0]?.[0]).toEqual({ path: WORKSPACE });

    await act(async () => {
      resolveInspection({ gitIdentity: IDENTITY });
    });
    await flush();

    expect(inspectionRegion()).toBe(region);
    expect(nameValue()).toBe(IDENTITY.name);
    expect(emailValue()).toBe(IDENTITY.email);
  });

  it("READY: Name and Email are pre-filled from git config, with 'Read from <path>' as the source note", async () => {
    openInspectionStep();
    await flush();

    const region = inspectionRegion();
    expect(nameValue()).toBe("Repo Owner");
    expect(emailValue()).toBe("owner@example.com");
    expect(getEl("inspection-source").textContent).toBe(
      INSPECTION_COPY.readFrom(WORKSPACE),
    );
    expect(region.querySelector(".async-region--loading")).toBeNull();
    expect(region.querySelector(".async-region-stale-badge")).toBeNull();
    expect(region.querySelector(".feedback-banner")).toBeNull();
  });

  it("a selection read in its own local path inspects that path instead of the workspace root", async () => {
    openInspectionStep({
      repoConfigs: {
        "repo-app": {
          role: "gitHost",
          roles: ["gitHost"],
          localPath: "/checkouts/app",
        },
      },
    });
    await flush();

    expect(inspectRepository).toHaveBeenCalledTimes(1);
    expect(inspectRepository.mock.calls[0]?.[0]).toEqual({
      path: "/checkouts/app",
    });
    expect(getEl("inspection-source").textContent).toBe(
      INSPECTION_COPY.readFrom("/checkouts/app"),
    );
  });

  it("EMPTY (nothing selected): guidance instead of a read, and nothing is inspected", async () => {
    openInspectionStep({ selectedRepoIds: [] });
    await flush();

    const region = inspectionRegion();
    expect(region.querySelector(".async-region--empty")).not.toBeNull();
    expect(region.textContent).toContain(INSPECTION_COPY.emptyNoSelection);
    expect(inspectRepository).not.toHaveBeenCalled();
  });

  it("no directory to read: the home folder's git configuration is read", async () => {
    openInspectionStep({ workspacePath: "" });
    await flush();

    expect(inspectRepository).toHaveBeenCalledWith({ path: "~" });
    expect(inspectionRegion().querySelector(".async-region--empty")).toBeNull();
  });

  it("ERROR: a failed read renders canonical copy and a working retry, never the transport message", async () => {
    let attempts = 0;
    inspectRepository = mock(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new ApiError("socket hang up", 500, { error: "socket hang up" });
      }
      return inspectionResponse(WORKSPACE, IDENTITY);
    });
    api.inspectRepository = inspectRepository as never;

    openInspectionStep();
    await flush();

    const region = inspectionRegion();
    const errorRegion = region.querySelector(".async-region--error");
    expect(errorRegion).not.toBeNull();
    expect(errorRegion?.textContent).toContain(STATE_COPY.errorFallback);
    expect(region.textContent).not.toContain("socket hang up");
    expect(document.getElementById("git-identity-name-input")).toBeNull();

    const retry = region.querySelector<HTMLButtonElement>(".retry-action");
    expect(retry).not.toBeNull();
    await act(async () => {
      fireEvent.click(retry as HTMLButtonElement);
    });
    await flush();

    expect(inspectionRegion().querySelector(".async-region--error")).toBeNull();
    expect(nameValue()).toBe("Repo Owner");
  });

  describe("The identity belongs to this project (git config is never written)", () => {
    it("NO IDENTITY IN GIT CONFIG: the fields are empty, the note says so, and nothing is invented", async () => {
      inspectRepository = mock(async () => inspectionResponse(WORKSPACE));
      api.inspectRepository = inspectRepository as never;

      openInspectionStep();
      await flush();

      expect(nameValue()).toBe("");
      expect(emailValue()).toBe("");
      expect(getEl("inspection-source").textContent).toBe(
        INSPECTION_COPY.identityMissing(WORKSPACE),
      );
    });

    it("offers no git-config write: no scope control, no configure button, no configure request", async () => {
      inspectRepository = mock(async () => inspectionResponse(WORKSPACE));
      api.inspectRepository = inspectRepository as never;
      const fetchSpy = mock(async () => new Response("{}"));
      const realFetch = globalThis.fetch;
      globalThis.fetch = fetchSpy as never;
      try {
        openInspectionStep();
        await flush();
        typeInput(getEl("git-identity-name-input"), "Ada Lovelace");
        typeInput(getEl("git-identity-email-input"), "ada@work.example");
        await flush();

        expect(document.querySelector("[data-segment-value]")).toBeNull();
        expect(
          document.getElementById("btn-configure-git-identity"),
        ).toBeNull();
        expect(
          fetchSpy.mock.calls.filter((call) =>
            String((call as unknown[])[0]).includes("configure-git-identity"),
          ),
        ).toHaveLength(0);
      } finally {
        globalThis.fetch = realFetch;
      }
    });

    it("an edited identity survives leaving the step and coming back", async () => {
      openInspectionStep();
      await flush();

      typeInput(getEl("git-identity-name-input"), "Ada Work");
      typeInput(getEl("git-identity-email-input"), "ada@work.example");

      const retryRead = inspectRepository.mock.calls.length;
      fireEvent.click(getEl("btn-step-4-back"));
      fireEvent.click(getEl("btn-step-3-next"));
      await flush();

      expect(inspectRepository.mock.calls.length).toBe(retryRead);
      expect(nameValue()).toBe("Ada Work");
      expect(emailValue()).toBe("ada@work.example");
    });

    it("reports a problem when a field is left, never while typing (#268)", async () => {
      inspectRepository = mock(async () => inspectionResponse(WORKSPACE));
      api.inspectRepository = inspectRepository as never;

      openInspectionStep();
      await flush();

      const nameInput = getEl<HTMLInputElement>("git-identity-name-input");
      const emailInput = getEl<HTMLInputElement>("git-identity-email-input");

      typeInput(nameInput, "Ada Lovelace");
      typeInput(emailInput, "invalid-email");
      expect(document.getElementById("git-identity-email-error")).toBeNull();

      leaveInput(emailInput);
      expect(getEl("git-identity-email-error").textContent).toContain(
        INSPECTION_COPY.emailInvalidError,
      );

      typeInput(emailInput, "ada@example.com");
      typeInput(nameInput, "Ada\x07Lovelace");
      expect(document.getElementById("git-identity-email-error")).toBeNull();
      expect(document.getElementById("git-identity-name-error")).toBeNull();

      leaveInput(nameInput);
      expect(getEl("git-identity-name-error").textContent).toContain(
        INSPECTION_COPY.nameInvalidError,
      );
    });

    it("an emptied required field reports its problem on leaving it", async () => {
      openInspectionStep();
      await flush();

      const nameInput = getEl<HTMLInputElement>("git-identity-name-input");
      typeInput(nameInput, "");
      leaveInput(nameInput);
      expect(getEl("git-identity-name-error").textContent).toContain(
        INSPECTION_COPY.nameRequiredError,
      );
    });
  });

  it("STALE: changing the workspace root marks the recorded identity out of date, keeps it visible, and re-reads it for the new directory", async () => {
    let calls = 0;
    let resolveSecondRead!: (value: unknown) => void;
    const secondRead = new Promise<unknown>((resolve) => {
      resolveSecondRead = resolve;
    });
    inspectRepository = mock(async (payload: { path: string }) => {
      calls += 1;
      if (calls === 1) {
        return inspectionResponse(payload.path, IDENTITY);
      }
      return secondRead;
    });
    api.inspectRepository = inspectRepository as never;

    openInspectionStep();
    await flush();
    expect(nameValue()).toBe("Repo Owner");

    // Back to Basics and move the workspace root. (Step 4 → 1, three Backs.)
    fireEvent.click(getEl("btn-step-4-back"));
    fireEvent.click(getEl("btn-step-3-back"));
    fireEvent.click(getEl("btn-step-2-back"));
    expect(document.getElementById("onboard-step-1")).not.toBeNull();
    await typeInput(getEl("onboard-workspace-path"), "/work/other");
    fireEvent.click(getEl("btn-step-1-next"));

    // Returning to Connect resets the in-memory verification results (#143),
    // so both connections are verified again before the journey continues.
    await act(async () => {
      fireEvent.click(getEl("btn-verify-all"));
    });
    fireEvent.click(getEl("btn-step-2-next"));
    expect(document.getElementById("onboard-step-3")).not.toBeNull();
    await flush();
    fireEvent.click(getEl("btn-step-3-next"));
    expect(document.getElementById("onboard-step-4")).not.toBeNull();

    // The identity on screen was resolved for the OLD directory: it is flagged
    // out of date while the read for the new one is still in flight.
    const region = inspectionRegion();
    expect(region.querySelector(".async-region-stale-badge")?.textContent).toBe(
      STATE_COPY.stale,
    );
    expect(nameValue()).toBe("Repo Owner");
    expect(inspectRepository.mock.calls.at(-1)?.[0]).toEqual({
      path: "/work/other",
    });

    await act(async () => {
      resolveSecondRead(
        inspectionResponse("/work/other", {
          name: "Second Owner",
          email: "second@example.com",
        }),
      );
    });
    await flush();

    expect(
      inspectionRegion().querySelector(".async-region-stale-badge"),
    ).toBeNull();
    expect(nameValue()).toBe("Second Owner");
    expect(emailValue()).toBe("second@example.com");
    // Reading the resolved record into state never re-triggers the read.
    expect(inspectRepository).toHaveBeenCalledTimes(2);
  });

  // ── Smoothness #4 and #6 (#148): the stale badge, and re-entry ─────────────
  describe("Smoothness — stale badges re-check, and re-entry does not re-read (#148)", () => {
    /** One repository selected at `/work/rocket`, with the identity resolved. */
    async function openResolvedStepFour() {
      inspectRepository = mock(async (payload: { path: string }) =>
        inspectionResponse(payload.path, IDENTITY),
      );
      api.inspectRepository = inspectRepository as never;
      openInspectionStep();
      await flush();
      expect(nameValue()).toBe("Repo Owner");
      expect(inspectRepository).toHaveBeenCalledTimes(1);
    }

    /** Moves the workspace root, which makes the recorded identity stale. */
    async function moveWorkspaceRoot(to: string) {
      fireEvent.click(getEl("btn-step-4-back"));
      fireEvent.click(getEl("btn-step-3-back"));
      fireEvent.click(getEl("btn-step-2-back"));
      await typeInput(getEl("onboard-workspace-path"), to);
      fireEvent.click(getEl("btn-step-1-next"));
      await act(async () => {
        fireEvent.click(getEl("btn-verify-all"));
      });
      fireEvent.click(getEl("btn-step-2-next"));
      fireEvent.click(getEl("btn-step-3-next"));
      expect(document.getElementById("onboard-step-4")).not.toBeNull();
    }

    it("SMOOTHNESS #4: the stale badge honours its refresh and clears only on a genuinely newer result", async () => {
      await openResolvedStepFour();

      // The read for the moved root FAILS — the stale value stays on screen.
      inspectRepository = mock(async () => {
        throw new TypeError("Failed to fetch");
      });
      api.inspectRepository = inspectRepository as never;
      await moveWorkspaceRoot("/work/other");
      await flush();

      const region = inspectionRegion();
      const badge = () =>
        inspectionRegion().querySelector(".async-region-stale-badge");
      // The identity on screen was resolved for the OLD root: stale, visible.
      expect(badge()?.textContent).toBe(STATE_COPY.stale);
      expect(nameValue()).toBe("Repo Owner");
      const refresh = region.querySelector(
        ".async-region-stale .retry-action",
      ) as HTMLButtonElement;
      expect(refresh.textContent).toContain(STATE_COPY.refresh);

      // The refresh ran and FAILED: stale-ness is not cleared by an attempt,
      // and the failure is not swallowed — it rides along as a diagnostic.
      expect(inspectRepository).toHaveBeenCalledTimes(1);
      const banner = inspectionRegion().querySelector(
        ".feedback-banner--error",
      );
      expect(banner).not.toBeNull();
      expect(banner?.querySelector(".retry-action")).not.toBeNull();

      // ...and again, from the failure's own retry: still stale while the
      // failure stands.
      await act(async () => {
        fireEvent.click(
          banner?.querySelector(".retry-action") as HTMLButtonElement,
        );
      });
      await flush();
      expect(inspectRepository).toHaveBeenCalledTimes(2);
      expect(badge()?.textContent).toBe(STATE_COPY.stale);
      expect(nameValue()).toBe("Repo Owner");

      // A genuinely newer result lands: now — and only now — the badge clears.
      inspectRepository = mock(async (payload: { path: string }) =>
        inspectionResponse(payload.path, {
          name: "Second Owner",
          email: "second@example.com",
        }),
      );
      api.inspectRepository = inspectRepository as never;
      await act(async () => {
        fireEvent.click(
          inspectionRegion().querySelector(
            ".async-region-stale .retry-action",
          ) as HTMLButtonElement,
        );
      });
      await flush();

      expect(
        inspectionRegion().querySelector(".async-region-stale-badge"),
      ).toBeNull();
      expect(
        inspectionRegion().querySelector(".feedback-banner--error"),
      ).toBeNull();
      expect(nameValue()).toBe("Second Owner");
      expect(emailValue()).toBe("second@example.com");
    });

    it("SMOOTHNESS #6: going back to Inspection and forward again does not fire a second read, while a changed input still does", async () => {
      await openResolvedStepFour();

      // Review → Inspection → Review: the identity already on screen was
      // resolved for exactly the current inputs, so nothing is fetched again.
      fireEvent.click(getEl("btn-step-4-next"));
      expect(document.getElementById("onboard-step-5")).not.toBeNull();
      fireEvent.click(getEl("btn-step-5-back"));
      expect(document.getElementById("onboard-step-4")).not.toBeNull();
      await flush();
      expect(inspectRepository).toHaveBeenCalledTimes(1);
      // Same step, same region, same identity — nothing was rebuilt from zero.
      expect(nameValue()).toBe("Repo Owner");
      expect(
        inspectionRegion().querySelector(".async-region--loading"),
      ).toBeNull();

      // The skip is guarded by the fingerprint, not by a blanket rule: moving
      // the root still re-reads.
      await moveWorkspaceRoot("/work/moved");
      await flush();
      expect(inspectRepository).toHaveBeenCalledTimes(2);
      expect(inspectRepository.mock.calls[1]?.[0]).toEqual({
        path: "/work/moved",
      });
    });
  });
});
