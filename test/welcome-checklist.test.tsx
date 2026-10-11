// test/welcome-checklist.test.tsx — The first-run welcome as a user meets it
// (#269, spec #241 stories 109–111).
//
// Behaviour only: which steps the checklist shows, which of them are ticked for
// a given state, what a step still needs, where each step's action goes, that
// the add-project step opens the assistant sheet (#268), what the region does
// while it is loading or failing, and which screen the app's landing sends a
// first visit to. Nothing here pins class names, ids or markup.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import {
  STATE_COPY,
  WELCOME_COPY,
  WIZARD_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import {
  deriveSetupChecklist,
  type SetupState,
} from "../src/frontend/lib/setup-checklist.js";
import { routeDefinitions } from "../src/frontend/routes.js";
import { WelcomeView } from "../src/frontend/views/WelcomeView.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";
import type { ModelConnectionView } from "../src/shared/model-connection-types.js";
import type { ModelRoles, Project, Run } from "../src/shared/types.js";

afterAll(async () => {
  await unregisterHappyDom();
});

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  localStorage.clear();
});

/** Everything a query answers with, unless a test says otherwise. */
function stubFetch(): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

function makeProject(overrides: Partial<Project> = {}): Project {
  return { id: "demo-app", name: "Demo App", ...overrides } as Project;
}

function makeRun(): Run {
  return { id: "run-1", status: "executing" } as unknown as Run;
}

/** The model the roles may point at. */
const MODEL_ID = "gemini-2.5-pro";

/** A connection as the API returns it: one model, checked unless overridden. */
function makeConnection(
  overrides: Partial<ModelConnectionView> = {},
): ModelConnectionView {
  return {
    id: "conn-1",
    name: "Gemini",
    apiType: "gemini",
    baseUrl: "",
    verifiedAt: "2026-10-01T00:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    models: [{ modelId: MODEL_ID, limits: {}, budget: {} }],
    availableModels: [],
    hasKey: true,
    keyLast4: "1234",
    keySource: "stored",
    ...overrides,
  } as unknown as ModelConnectionView;
}

/** Both roles set to the model the verified connection offers. */
const ROLES: ModelRoles = {
  builder: { connectionId: "conn-1", modelId: MODEL_ID },
  reviewer: { connectionId: "conn-1", modelId: MODEL_ID },
};

interface WelcomeState {
  projects?: Project[];
  runs?: Run[];
  connections?: ModelConnectionView[];
  roles?: ModelRoles | undefined;
}

/** The whole app as the cache has it: the four facts the checklist reads. */
function makeClient(state: WelcomeState): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), state.projects ?? []);
  client.setQueryData(queryKeys.runs(), state.runs ?? []);
  client.setQueryData(
    queryKeys.settings(),
    state.roles ? { roles: state.roles } : {},
  );
  client.setQueryData(queryKeys.modelConnections(), state.connections ?? []);
  return client;
}

function renderWelcomeView(client: QueryClient) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        // The assistant is mounted inside the router, exactly as the shell's
        // modal container mounts it.
        element: (
          <>
            <WizardModal />
            <Outlet />
          </>
        ),
        children: [{ path: "welcome", element: <WelcomeView /> }],
      },
    ],
    { initialEntries: ["/welcome"] },
  );
  return {
    ...render(
      <QueryClientProvider client={client}>
        <ProjectProvider>
          <ModalProvider>
            <RouterProvider router={router} />
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    ),
    client,
  };
}

/** The welcome with the state in place: the way a returning user sees it. */
function renderWelcome(state: WelcomeState = {}) {
  stubFetch();
  return renderWelcomeView(makeClient(state));
}

/** The app's landing, on its own route definitions, as the browser loads it. */
function renderLanding(state: WelcomeState = {}) {
  stubFetch();
  const router = createMemoryRouter(routeDefinitions, {
    initialEntries: ["/"],
  });
  const view = render(
    <QueryClientProvider client={makeClient(state)}>
      <ProjectProvider>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

/** The three steps, in the order the screen shows them. */
function stepRows(view: {
  getAllByRole: (role: "listitem") => HTMLElement[];
}): HTMLElement[] {
  return view.getAllByRole("listitem");
}

/** Which steps are ticked, read from the state word each row shows. */
function ticked(view: {
  getAllByRole: (role: "listitem") => HTMLElement[];
}): boolean[] {
  return stepRows(view).map(
    (row) => row.textContent?.includes(WELCOME_COPY.done) === true,
  );
}

const COMPLETE: WelcomeState = {
  projects: [makeProject()],
  runs: [makeRun()],
  connections: [makeConnection()],
  roles: ROLES,
};

describe("the first-run checklist (#269)", () => {
  it("lists the three steps, none of them ticked, and names what each still needs", () => {
    const view = renderWelcome();

    const rows = stepRows(view);
    expect(rows).toHaveLength(3);
    expect(
      rows.map(
        (row) =>
          within(row).getByRole("heading", { level: 2 }).textContent ?? "",
      ),
    ).toEqual([
      WELCOME_COPY.stepTitle.project,
      WELCOME_COPY.stepTitle.model,
      WELCOME_COPY.stepTitle.run,
    ]);

    expect(ticked(view)).toEqual([false, false, false]);
    expect(rows[0]?.textContent).toContain(WELCOME_COPY.gap["no-project"]);
    expect(rows[1]?.textContent).toContain(
      WELCOME_COPY.gap["no-verified-connection"],
    );
    expect(rows[1]?.textContent).toContain(WELCOME_COPY.gap["roles-not-set"]);
    expect(rows[2]?.textContent).toContain(WELCOME_COPY.gap["no-run"]);
    expect(view.getByText(WELCOME_COPY.progress(0, 3))).toBeTruthy();
  });

  const tickedCases: ReadonlyArray<{
    name: string;
    state: WelcomeState;
    expected: boolean[];
  }> = [
    {
      name: "nothing at all is set up",
      state: {},
      expected: [false, false, false],
    },
    {
      name: "a project exists",
      state: { projects: [makeProject()] },
      expected: [true, false, false],
    },
    {
      name: "a project, a checked connection and both roles are in place",
      state: {
        projects: [makeProject()],
        connections: [makeConnection()],
        roles: ROLES,
      },
      expected: [true, true, false],
    },
    {
      name: "a run has started too",
      state: COMPLETE,
      expected: [true, true, true],
    },
  ];

  for (const { name, state, expected } of tickedCases) {
    it(`ticks each step that is really done: ${name}`, () => {
      const view = renderWelcome(state);
      expect(ticked(view)).toEqual(expected);
      expect(
        view.getByText(
          WELCOME_COPY.progress(
            expected.filter(Boolean).length,
            expected.length,
          ),
        ),
      ).toBeTruthy();
    });
  }

  it("ticks a step the moment its state arrives, without a reload", async () => {
    const view = renderWelcome();
    expect(ticked(view)).toEqual([false, false, false]);

    await act(async () => {
      view.client.setQueryData(queryKeys.projects(), [makeProject()]);
    });

    await waitFor(() => expect(ticked(view)).toEqual([true, false, false]));
    expect(view.queryByText(WELCOME_COPY.gap["no-project"])).toBeNull();
  });

  it("leaves the model step open while its connection has not been checked", () => {
    const view = renderWelcome({
      projects: [makeProject()],
      connections: [makeConnection({ verifiedAt: null })],
      roles: ROLES,
    });

    expect(ticked(view)).toEqual([true, false, false]);
    const modelRow = stepRows(view)[1];
    expect(modelRow?.textContent).toContain(
      WELCOME_COPY.gap["no-verified-connection"],
    );
  });

  it("leaves the model step open while one role has no model", () => {
    const view = renderWelcome({
      projects: [makeProject()],
      connections: [makeConnection()],
      roles: { builder: ROLES.builder },
    });

    expect(ticked(view)).toEqual([true, false, false]);
    expect(stepRows(view)[1]?.textContent).toContain(
      WELCOME_COPY.gap["roles-not-set"],
    );
  });

  it("leaves the model step open when a role names a model the connection does not offer", () => {
    const view = renderWelcome({
      projects: [makeProject()],
      connections: [makeConnection()],
      roles: {
        builder: { connectionId: "conn-1", modelId: "not-on-the-connection" },
        reviewer: ROLES.reviewer,
      },
    });

    expect(ticked(view)).toEqual([true, false, false]);
    expect(stepRows(view)[1]?.textContent).toContain(
      WELCOME_COPY.gap["roles-not-set"],
    );
  });
});

describe("each step goes where it is finished (#269)", () => {
  it("opens the add-project assistant from the first step", () => {
    const view = renderWelcome();

    expect(view.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      view.getByRole("button", { name: WELCOME_COPY.stepAction.project }),
    );

    expect(view.getByRole("dialog", { name: WIZARD_COPY.title })).toBeTruthy();
  });

  it("links the model step to the Settings pane that owns Check Connection and the roles", () => {
    const view = renderWelcome();

    expect(
      view
        .getByRole("link", { name: WELCOME_COPY.stepAction.model })
        .getAttribute("href"),
    ).toBe(WELCOME_COPY.stepPath.model);
  });

  it("links the run step to Tickets, where a run is started", () => {
    const view = renderWelcome();

    expect(
      view
        .getByRole("link", { name: WELCOME_COPY.stepAction.run })
        .getAttribute("href"),
    ).toBe(WELCOME_COPY.stepPath.run);
  });
});

describe("the welcome's read region (#269)", () => {
  it("announces one wait and ticks nothing while the setup is unknown", () => {
    globalThis.fetch = (() =>
      new Promise<Response>(() => {})) as unknown as typeof fetch;

    const view = renderWelcomeView(
      new QueryClient({
        defaultOptions: { queries: { retry: false, staleTime: Infinity } },
      }),
    );

    expect(view.getByRole("status").textContent).toContain(STATE_COPY.loading);
    expect(view.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("shows the canonical error, then brings every part of the setup back through its retry", async () => {
    // The setup cannot be read until the retry: every part fails first, and
    // every part answers afterwards. The checklist can only appear if the
    // retry asked all four again — one lazy part would leave the region down.
    let readable = false;
    const asked: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      asked.push(url);
      if (!readable) return new Response("not json", { status: 500 });
      return new Response(url.includes("/api/settings") ? "{}" : "[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const view = renderWelcomeView(client);

    await waitFor(() => expect(view.getByRole("alert")).toBeTruthy());
    const alert = view.getByRole("alert");
    expect(alert.textContent).toContain(STATE_COPY.errorFallback);
    expect(alert.textContent).not.toContain("not json");
    expect(view.queryAllByRole("listitem")).toHaveLength(0);

    // Let the first burst settle: retrying a request still in flight would be
    // the in-flight one, not a new ask.
    await waitFor(() => expect(client.isFetching()).toBe(0));
    readable = true;
    fireEvent.click(view.getByRole("button", { name: STATE_COPY.retry }));

    await waitFor(() => expect(stepRows(view)).toHaveLength(3));
    expect(view.queryByRole("alert")).toBeNull();
    expect(ticked(view)).toEqual([false, false, false]);
    expect(asked).toContain("/api/projects");
    expect(asked).toContain("/api/model-connections");
  });
});

describe("deriveSetupChecklist (#269)", () => {
  const withState = (state: Partial<SetupState>) =>
    deriveSetupChecklist({
      projects: [],
      runs: [],
      connections: [],
      roles: undefined,
      ...state,
    });

  it("reports every gap, in the order the screen shows them", () => {
    const checklist = withState({});
    expect(checklist.steps.map((step) => step.id)).toEqual([
      "project",
      "model",
      "run",
    ]);
    expect(checklist.steps.map((step) => [...step.gaps])).toEqual([
      ["no-project"],
      ["no-verified-connection", "roles-not-set"],
      ["no-run"],
    ]);
    expect(checklist.doneCount).toBe(0);
    expect(checklist.complete).toBe(false);
  });

  it("is complete only when all three steps are done, and counts the ticks", () => {
    const checklist = withState({
      projects: [makeProject()],
      runs: [makeRun()],
      connections: [makeConnection()],
      roles: ROLES,
    });
    expect(checklist.steps.every((step) => step.done)).toBe(true);
    expect(checklist.steps.every((step) => step.gaps.length === 0)).toBe(true);
    expect(checklist.doneCount).toBe(3);
    expect(checklist.complete).toBe(true);
  });
});

describe("the app's landing (#269)", () => {
  it("takes a first visit to the welcome while setup is incomplete", async () => {
    const { router } = renderLanding();
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/welcome"),
    );
  });

  it("takes a finished setup on to Tickets, so the welcome goes away", async () => {
    const { router } = renderLanding(COMPLETE);
    await waitFor(() =>
      expect(router.state.location.pathname).toBe("/tickets"),
    );
  });

  it("waits, announced once, while the setup is still unknown", () => {
    globalThis.fetch = (() =>
      new Promise<Response>(() => {})) as unknown as typeof fetch;
    const router = createMemoryRouter(routeDefinitions, {
      initialEntries: ["/"],
    });
    const view = render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false, staleTime: Infinity },
            },
          })
        }
      >
        <ProjectProvider>
          <ModalProvider>
            <RouterProvider router={router} />
          </ModalProvider>
        </ProjectProvider>
      </QueryClientProvider>,
    );

    const announced = view
      .getAllByRole("status")
      .map((element) => element.textContent ?? "");
    expect(announced.some((text) => text.includes(STATE_COPY.loading))).toBe(
      true,
    );
    // No guess: the landing stays where it is until the state answers.
    expect(router.state.location.pathname).toBe("/");
  });
});
