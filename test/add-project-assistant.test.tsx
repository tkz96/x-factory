// test/add-project-assistant.test.tsx — The add-project assistant sheet, as
// behaviour (#268, spec #241 stories 112–118).
//
// This replaces the two structural suites the screen used to carry
// (`frontend-wizard-skeleton.test.tsx` and `wizard-modal-layout.test.tsx`):
// nothing here reads a class name or a wrapper id to decide whether the screen
// works. It opens the assistant the way a user does — through Add Project —
// types, presses, presses Escape, and asserts on roles, names, announcements
// and outcomes.

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
import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import {
  REPOSITORY_STEP_COPY,
  WIZARD_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { clearWizardDraft } from "../src/frontend/wizard/storage.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";
import type { Project } from "../src/shared/types.js";

const MANIFEST: ProviderDescriptor[] = [
  {
    id: "stub-provider",
    displayName: "Stub Provider",
    roles: ["tracker", "gitHost"],
    iconRef: "provider-stub",
    capabilities: ["listRepositories"],
    configFields: [],
  },
];

const REPOSITORY_URL = "https://git.example.com/acme/titan.git";

const CREATED_PROJECT: Project = {
  id: "titan",
  name: "Titan",
  workspacePath: "/work/titan",
  repositoryPath: "/work/titan/app",
  defaultBranch: "main",
  testCommand: "bun test",
  issueTracker: { provider: "stub-provider" },
} as unknown as Project;

function getEl<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element #${id} not found`);
  return el as T;
}

/** Types into a field the way the browser does: focus, change, keyup. */
function typeInput(input: HTMLElement, value: string) {
  act(() => {
    input.focus();
    fireEvent.change(input, { target: { value } });
    fireEvent.keyUp(input);
  });
}

/**
 * Leaves a field the way the browser does, so blur and focusout both fire.
 * Not `fireEvent.blur`: happy-dom's synthetic blur leaves React's change
 * bookkeeping for that node broken, so the next keystroke never reaches
 * `onChange` (and React throws inside its event plugin). The DOM's own
 * `blur()` is the same interaction a real blur is.
 */
function leaveInput(input: HTMLElement) {
  act(() => {
    input.blur();
  });
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function LocationProbe() {
  const location = useLocation();
  return <span id="location">{location.pathname}</span>;
}

function Harness() {
  const { openOnboardingModal, closeOnboardingModal, isOnboardingOpen } =
    useModal();
  return (
    <div>
      <main id="page">
        <button
          type="button"
          id="btn-open-wizard"
          onClick={openOnboardingModal}
        >
          Add Project
        </button>
      </main>
      <span id="wizard-open-status">
        {isOnboardingOpen ? "open" : "closed"}
      </span>
      <LocationProbe />
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

/** The sheet's dialog element — the screen everything is asserted inside. */
function sheet(): HTMLElement {
  const dialog = document.getElementById("onboarding-wizard-modal");
  if (!dialog) throw new Error("The assistant sheet is not open");
  return dialog;
}

/** Presses the assistant's Continue for the step it is on. */
function pressContinue() {
  const counter = getEl("wizard-progress-counter").textContent ?? "";
  const match = /Step (\d) of 5/.exec(counter);
  if (!match) throw new Error(`Unexpected step counter: ${counter}`);
  fireEvent.click(getEl(`btn-step-${match[1]}-next`));
}

/** Fills step 1 the way the assistant asks for it: URL, name, workspace. */
async function completeStepOne(
  url = REPOSITORY_URL,
  name = "Titan",
  workspace = "/work/titan",
) {
  typeInput(getEl("onboard-repo-url"), url);
  typeInput(getEl("onboard-proj-name"), name);
  typeInput(getEl("onboard-workspace-path"), workspace);
  // Leaving the URL field asks the providers about the pasted URL; let that
  // settle inside the act that typing opened.
  await flush();
}

/**
 * A full journey to Review with the stub provider serving both roles: the
 * shortest real path to the assistant's terminal state.
 */
async function runToReview() {
  renderWizard();
  fireEvent.click(getEl("btn-open-wizard"));
  await completeStepOne();
  pressContinue();
  await flush();

  act(() => {
    fireEvent.change(getEl("select-tracker-provider"), {
      target: { value: "stub-provider" },
    });
    fireEvent.change(getEl("select-gitHost-provider"), {
      target: { value: "stub-provider" },
    });
  });
  await act(async () => {
    fireEvent.click(getEl("btn-verify-all"));
  });
  await flush();
  pressContinue();
  await flush();

  act(() => {
    fireEvent.click(getEl("repo-select-repo-1"));
  });
  pressContinue();
  await flush();
  pressContinue();
  await flush();
}

/** Presses the Review step's submit and lets the creation land. */
async function submitReview() {
  await act(async () => {
    fireEvent.click(getEl("btn-step-5-submit"));
  });
  await flush();
}

/** Opens the assistant and presses Escape, which is the dismissal path. */
function pressEscape() {
  act(() => {
    fireEvent.keyDown(window, { key: "Escape" });
  });
}

describe("Add Project assistant (#268)", () => {
  beforeEach(() => {
    clearWizardDraft();
    document.body.style.overflow = "";
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
    api.inspectRepository = mock(async (payload: { path: string }) => ({
      path: payload.path,
      exists: true,
      isGitRepo: true,
      isRepositoryRoot: true,
      gitIdentity: { name: "Stub Owner", email: "stub@example.com" },
      detectedCommands: {},
      detectedTooling: [],
      readiness: { status: "ready" as const, message: "ready" },
    }));
    api.createProject = mock(async () => CREATED_PROJECT);
  });

  afterEach(() => {
    cleanup();
    clearWizardDraft();
    document.body.style.overflow = "";
  });

  afterAll(async () => {
    await unregisterHappyDom();
  });

  it("opens on step 1 with the counter, the progress bar and Cancel left of Continue", () => {
    renderWizard();
    expect(getEl("wizard-open-status").textContent).toBe("closed");

    act(() => {
      getEl("btn-open-wizard").focus();
      fireEvent.click(getEl("btn-open-wizard"));
    });

    expect(getEl("wizard-open-status").textContent).toBe("open");
    const screen = within(sheet());
    expect(
      screen.getByRole("heading", { name: WIZARD_COPY.title }),
    ).toBeDefined();
    expect(getEl("wizard-progress-counter").textContent).toBe("Step 1 of 5");

    const bar = screen.getByRole("progressbar", {
      name: WIZARD_COPY.progressLabel,
    });
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("5");

    // Mac assistant order: Cancel on the left, the step's actions on the right.
    const actionBar = getEl("onboarding-wizard-modal").querySelector(
      ".wizard-sheet-footer",
    );
    expect(actionBar).not.toBeNull();
    const labels = Array.from(
      (actionBar as HTMLElement).querySelectorAll("button"),
    ).map((button) => button.textContent);
    expect(labels).toEqual([WIZARD_COPY.cancel, WIZARD_COPY.continue]);
  });

  it("counts the step and moves the bar as the assistant goes on", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await completeStepOne();

    pressContinue();
    await flush();

    expect(getEl("wizard-progress-counter").textContent).toBe("Step 2 of 5");
    expect(
      within(sheet())
        .getByRole("progressbar", { name: WIZARD_COPY.progressLabel })
        .getAttribute("aria-valuenow"),
    ).toBe("2");

    // Back is offered from step 2 on, and returns with the work intact.
    fireEvent.click(getEl("btn-step-2-back"));
    expect(getEl("wizard-progress-counter").textContent).toBe("Step 1 of 5");
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe(
      REPOSITORY_URL,
    );
    expect(getEl<HTMLInputElement>("onboard-proj-name").value).toBe("Titan");
  });

  it("asks for the repository URL first, before the project's details", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    const urlField = within(sheet()).getByLabelText(
      REPOSITORY_STEP_COPY.urlLabel,
    );
    const nameField = within(sheet()).getByLabelText(
      REPOSITORY_STEP_COPY.nameLabel,
    );
    expect(
      urlField.compareDocumentPosition(nameField) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("reports a malformed URL when the field is left, and never while typing", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    const urlField = getEl<HTMLInputElement>("onboard-repo-url");
    const alerts = () => within(sheet()).queryAllByRole("alert");
    // Let the dialog's own focus management settle before typing, exactly as a
    // user's first keystroke arrives after the sheet is up.
    await flush();

    typeInput(urlField, "not a repository");
    // Typing alone says nothing: no error, no alert — and the typing stays in
    // the field the user is typing in.
    expect(alerts().map((alert) => alert.textContent)).toEqual([]);
    expect(document.activeElement).toBe(urlField);

    leaveInput(urlField);
    expect(alerts()[0]?.textContent).toContain(REPOSITORY_STEP_COPY.urlInvalid);

    // Fixing it clears the error without waiting for another blur.
    typeInput(urlField, REPOSITORY_URL);
    expect(alerts().map((alert) => alert.textContent)).toEqual([]);
    await flush();
  });

  it("reports every missing field on Continue and stays on the step", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    fireEvent.click(getEl("btn-step-1-next"));

    const alerts = within(sheet())
      .getAllByRole("alert")
      .map((alert) => alert.textContent ?? "");
    expect(alerts).toContain(REPOSITORY_STEP_COPY.urlRequired);
    expect(alerts).toContain(REPOSITORY_STEP_COPY.nameRequired);
    expect(alerts).toContain(REPOSITORY_STEP_COPY.identifierRequired);
    expect(getEl("wizard-progress-counter").textContent).toBe("Step 1 of 5");
  });

  it("starts empty: X-Factory invents none of the project's details", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    // The workspace folder in particular has NO default: a path X-Factory made
    // up would be a path the user never chose (the old Basics step's safeguard,
    // kept as behaviour).
    expect(getEl<HTMLInputElement>("onboard-workspace-path").value).toBe("");
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe("");
    expect(getEl<HTMLInputElement>("onboard-proj-name").value).toBe("");
    expect(getEl<HTMLInputElement>("onboard-proj-id").value).toBe("");
    expect(getEl<HTMLTextAreaElement>("onboard-proj-description").value).toBe(
      "",
    );
  });

  it("derives the identifier from the project's name, until the user edits it", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    typeInput(getEl("onboard-proj-name"), "Apollo Engine");
    expect(getEl<HTMLInputElement>("onboard-proj-id").value).toBe(
      "apollo-engine",
    );

    // Once the identifier is the user's own, the name no longer overwrites it.
    typeInput(getEl("onboard-proj-id"), "apollo-custom");
    typeInput(getEl("onboard-proj-name"), "Apollo Engine II");
    expect(getEl<HTMLInputElement>("onboard-proj-id").value).toBe(
      "apollo-custom",
    );
  });

  it("closes without ceremony while there is nothing to lose", () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));

    fireEvent.click(getEl("btn-wizard-cancel"));

    expect(getEl("wizard-open-status").textContent).toBe("closed");
    expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
    expect(document.getElementById("wizard-dismiss-prompt")).toBeNull();
  });

  it("asks before losing work, and Cancel keeps the assistant as it was", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    await completeStepOne();
    pressContinue();
    await flush();
    expect(getEl("wizard-progress-counter").textContent).toBe("Step 2 of 5");

    pressEscape();

    // The question sits on top of the assistant, which is still there.
    expect(document.getElementById("onboarding-wizard-modal")).not.toBeNull();
    const ask = within(getEl("wizard-dismiss-prompt"));
    expect(
      ask.getByRole("button", { name: WIZARD_COPY.saveDraft }),
    ).toBeDefined();
    expect(
      ask.getByRole("button", { name: WIZARD_COPY.discard }),
    ).toBeDefined();
    expect(
      ask.getByRole("button", { name: WIZARD_COPY.keepEditing }),
    ).toBeDefined();

    fireEvent.click(getEl("btn-wizard-keep-editing"));

    expect(document.getElementById("wizard-dismiss-prompt")).toBeNull();
    // Still on step 2 and still holding what was typed on step 1.
    expect(getEl("wizard-progress-counter").textContent).toBe("Step 2 of 5");
    pressEscape(); // the prompt is really gone: Esc asks again
    fireEvent.click(getEl("btn-wizard-keep-editing"));
    fireEvent.click(getEl("btn-step-2-back"));
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe(
      REPOSITORY_URL,
    );
    expect(getEl<HTMLInputElement>("onboard-proj-name").value).toBe("Titan");
  });

  it("saves the draft when Save Draft is chosen, and picks it up again", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    typeInput(getEl("onboard-repo-url"), REPOSITORY_URL);
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe(
      REPOSITORY_URL,
    );

    pressEscape();
    act(() => {
      fireEvent.click(getEl("btn-wizard-save-draft"));
    });

    expect(getEl("wizard-open-status").textContent).toBe("closed");
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).not.toBeNull();

    // Reopening restores the draft, so the URL is where it was left.
    fireEvent.click(getEl("btn-open-wizard"));
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe(
      REPOSITORY_URL,
    );
  });

  it("drops the draft when Discard is chosen", async () => {
    renderWizard();
    fireEvent.click(getEl("btn-open-wizard"));
    typeInput(getEl("onboard-repo-url"), REPOSITORY_URL);

    pressEscape();
    act(() => {
      fireEvent.click(getEl("btn-wizard-discard"));
    });

    expect(getEl("wizard-open-status").textContent).toBe("closed");
    expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();

    // Reopening starts from scratch.
    fireEvent.click(getEl("btn-open-wizard"));
    expect(getEl<HTMLInputElement>("onboard-repo-url").value).toBe("");
  });

  it("ends on the created project, and Open Project goes to it", async () => {
    await runToReview();
    await submitReview();

    const screen = within(sheet());
    expect(
      screen.getByRole("heading", { name: WIZARD_COPY.successTitle }),
    ).toBeDefined();
    expect(
      screen.getByText(WIZARD_COPY.successBody(CREATED_PROJECT.name)),
    ).toBeDefined();
    expect(getEl("success-step-project-name").textContent).toBe("Titan");
    expect(getEl("success-step-project-id").textContent).toBe("titan");

    fireEvent.click(getEl("btn-open-project"));

    expect(getEl("location").textContent).toBe(
      `/projects/${CREATED_PROJECT.id}`,
    );
    expect(getEl("wizard-open-status").textContent).toBe("closed");
  });
});
