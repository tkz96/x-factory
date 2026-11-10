// test/projects-split.test.tsx — The Projects screens as a user meets them
// (#267, spec #241).
//
// Behaviour only: which projects a row offers and where a row goes, what the
// detail pane says in plain words (repository, tracker, branch — spec story
// 108), what the empty state offers, which filter the list is on, and that the
// toolbar's Add Project opens the add-project assistant. This file is what
// replaces the smoke assertions that used to pin the projects screen's class
// names, ids and markup (#267 acceptance criteria): the same page, asserted
// through roles, interactions and outcomes.

/// <reference lib="dom" />
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();

import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import {
  CONNECTIONS_COPY,
  PROJECT_DETAIL_COPY,
  PROJECTS_COPY,
  WIZARD_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import {
  projectFacts,
  projectRepository,
} from "../src/frontend/components/projects/project-facts.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import { ModalProvider } from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { routeDefinitions } from "../src/frontend/routes.js";
import { ProjectDetailView } from "../src/frontend/views/ProjectDetailView.js";
import { ProjectsView } from "../src/frontend/views/ProjectsView.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";
import type { Project } from "../src/shared/types.js";

afterAll(async () => {
  await unregisterHappyDom();
});

const realFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  globalThis.fetch = realFetch;
  localStorage.clear();
});

/** The manifest, as the server publishes it: names come from here, never a table. */
const MANIFEST: ProviderDescriptor[] = [
  {
    id: "tracker-one",
    displayName: "Tracker One",
    roles: ["tracker"],
    iconRef: "icon-tracker-one",
    capabilities: ["listTickets"],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
    ],
  },
  {
    id: "githost-one",
    displayName: "Git Host One",
    roles: ["gitHost"],
    iconRef: "icon-githost-one",
    capabilities: ["listRepositories"],
    configFields: [
      { name: "orgUrl", label: "Organization", type: "url", required: true },
    ],
  },
];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "demo-app",
    name: "Demo App",
    workspacePath: "/work/demo-app",
    repositoryPath: "/work/demo-app",
    defaultBranch: "main",
    testCommand: "bun test",
    issueTracker: { provider: "tracker-one" },
    connections: [
      {
        providerId: "tracker-one",
        roles: ["tracker"],
        config: { host: "https://tracker.example" },
      },
      {
        providerId: "githost-one",
        roles: ["gitHost"],
        config: { orgUrl: "https://git.example" },
      },
    ],
    repositories: [
      {
        id: "demo-app-primary",
        name: "Demo App",
        path: "/work/demo-app",
        defaultBranch: "main",
        role: "other",
      },
    ],
    ...overrides,
  } as Project;
}

function makeClient(projects: Project[]): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.projects(), projects);
  client.setQueryData(queryKeys.providers(), MANIFEST);
  client.setQueryData(queryKeys.readiness(), { ready: true, checks: [] });
  return client;
}

/** One of the two Projects routes, with the real router and the real views. */
function renderProjects(path: string, projects: Project[]) {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        // The assistant is mounted inside the router: it navigates to the
        // project it creates, exactly as the shell's modal container does.
        element: (
          <>
            <WizardModal />
            <Outlet />
          </>
        ),
        children: [
          { path: "projects", element: <ProjectsView /> },
          { path: "projects/:id", element: <ProjectDetailView /> },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = render(
    <QueryClientProvider client={makeClient(projects)}>
      <ProjectProvider>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
  return { ...view, router };
}

/**
 * The whole shell, on one of the Projects routes: the toolbar, the sections and
 * the modal container, so a toolbar action can be followed to its outcome.
 */
function renderShell(path: string) {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify([]), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
  const client = makeClient([makeProject()]);
  client.setQueryData(queryKeys.runs(), []);
  const router = createMemoryRouter(routeDefinitions, {
    initialEntries: [path],
  });
  return render(
    <QueryClientProvider client={client}>
      <ProjectProvider>
        <ModalProvider>
          <RouterProvider router={router} />
        </ModalProvider>
      </ProjectProvider>
    </QueryClientProvider>,
  );
}

/** One project's facts as label → value, read from the definition list. */
function factsOf(container: HTMLElement): Map<string, string> {
  return new Map(
    Array.from(container.querySelectorAll("dt")).map((term) => [
      term.textContent ?? "",
      term.parentElement?.querySelector("dd")?.textContent ?? "",
    ]),
  );
}

describe("Project facts — repository, tracker, branch in plain words (#267)", () => {
  it("names the primary repository, with its remote when one is recorded", () => {
    const project = makeProject({
      repositories: [
        {
          id: "r1",
          name: "rocket",
          remote: "https://git.example/acme/rocket",
          path: "/work/rocket",
          defaultBranch: "main",
        },
      ],
    });

    expect(projectRepository(project)).toEqual({
      value: "rocket — acme/rocket",
      isPath: false,
    });
  });

  it("names an Azure DevOps remote by its organization and project, and counts the other repositories", () => {
    const azure = (name: string) => ({
      id: name,
      name,
      remote: `https://xynotech@dev.azure.com/xynotech/Converso/_git/${name}`,
      path: `/work/${name}`,
      defaultBranch: "main",
    });
    expect(
      projectRepository(makeProject({ repositories: [azure("ai-engine")] }))
        .value,
    ).toBe("ai-engine — xynotech/Converso");
    expect(
      projectRepository(
        makeProject({
          repositories: [azure("ai-engine"), azure("ai-docs"), azure("RBRE")],
        }),
      ).value,
    ).toBe("ai-engine and 2 more — xynotech/Converso");
  });

  it("falls back to the folder the project is checked out in, as a path", () => {
    const project = makeProject({
      repositories: [],
      workspacePath: "/work/demo-app",
      repositoryPath: "/work/legacy",
    });

    expect(projectRepository(project)).toEqual({
      value: "/work/demo-app",
      isPath: true,
    });
  });

  it("says Not recorded only when the project records neither a repository nor a folder", () => {
    const project = makeProject({
      repositories: [],
      workspacePath: "   ",
      repositoryPath: "",
    });

    expect(projectRepository(project).value).toBe(PROJECTS_COPY.noRepository);
  });

  it("reads the tracker's name from the manifest, and Not connected when there is none", () => {
    const connected = projectFacts(makeProject(), MANIFEST);
    expect(connected[1]?.value).toBe("Tracker One");
    // The provider id is never the label when the manifest names the provider.
    expect(connected.map((fact) => fact.value).join(" ")).not.toContain(
      "tracker-one",
    );

    const missing = projectFacts(
      makeProject({
        connections: [
          {
            providerId: "githost-one",
            roles: ["gitHost"],
            config: { orgUrl: "https://git.example" },
          },
        ],
      }),
      MANIFEST,
    );
    expect(missing[1]?.value).toBe(CONNECTIONS_COPY.stateLabel.disconnected);
  });

  it("shows the branch runs start from, and the default when none is set", () => {
    const facts = projectFacts(
      makeProject({ defaultBranch: "release/2" }),
      MANIFEST,
    );
    expect(facts[2]?.value).toBe("release/2");

    const fallback = projectFacts(makeProject({ defaultBranch: "" }), MANIFEST);
    expect(fallback[2]?.value).toBe("Not set");
  });

  it("keeps the three facts in reading order: repository, tracker, branch", () => {
    expect(
      projectFacts(makeProject(), MANIFEST).map((fact) => fact.label),
    ).toEqual([
      PROJECTS_COPY.repositoryFact,
      PROJECTS_COPY.trackerFact,
      PROJECTS_COPY.branchFact,
    ]);
  });
});

describe("The Projects list (#267)", () => {
  it("lists every active project, each row a link to its own detail", () => {
    const view = renderProjects("/projects", [
      makeProject(),
      makeProject({ id: "other", name: "Other App" }),
      makeProject({ id: "old", name: "Old App", archived: true }),
    ]);

    const row = view.getByRole("link", {
      name: PROJECTS_COPY.openProject("Demo App"),
    });
    expect(row.getAttribute("href")).toBe("/projects/demo-app");
    expect(
      view.getByRole("link", { name: PROJECTS_COPY.openProject("Other App") }),
    ).toBeTruthy();
    // The archived project is not in the default filter's list.
    expect(
      view.queryByRole("link", { name: PROJECTS_COPY.openProject("Old App") }),
    ).toBeNull();
  });

  it("opens the project a row names", () => {
    const view = renderProjects("/projects", [makeProject()]);

    fireEvent.click(
      view.getByRole("link", { name: PROJECTS_COPY.openProject("Demo App") }),
    );

    expect(view.router.state.location.pathname).toBe("/projects/demo-app");
    // The row the URL names reads as the current one.
    expect(
      view
        .getByRole("link", { name: PROJECTS_COPY.openProject("Demo App") })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("switching the filter to Archived shows the archived projects instead", () => {
    const view = renderProjects("/projects", [
      makeProject(),
      makeProject({ id: "old", name: "Old App", archived: true }),
    ]);

    fireEvent.click(
      view.getByRole("radio", { name: PROJECTS_COPY.filterArchived }),
    );

    expect(
      view.getByRole("link", { name: PROJECTS_COPY.openProject("Old App") }),
    ).toBeTruthy();
    expect(
      view.queryByRole("link", { name: PROJECTS_COPY.openProject("Demo App") }),
    ).toBeNull();
  });

  it("says the archived filter is empty without offering Add Project", () => {
    const view = renderProjects("/projects", [makeProject()]);

    fireEvent.click(
      view.getByRole("radio", { name: PROJECTS_COPY.filterArchived }),
    );

    expect(view.getByRole("status").textContent).toContain(
      PROJECTS_COPY.emptyArchived,
    );
    expect(
      view.queryByRole("button", { name: PROJECTS_COPY.addProject }),
    ).toBeNull();
  });

  it("says the active filter is empty, and where the archived projects are", () => {
    const view = renderProjects("/projects", [
      makeProject({ id: "old", name: "Old App", archived: true }),
    ]);

    expect(view.getByRole("status").textContent).toContain(
      PROJECTS_COPY.emptyActive,
    );
  });

  it("keeps the list beside the detail on a project's route", () => {
    const view = renderProjects("/projects/demo-app", [
      makeProject(),
      makeProject({ id: "other", name: "Other App" }),
    ]);

    // The same list, whichever route is showing: choosing another project is
    // one click away, and the URL — not a copy of the state — says which
    // project the detail shows.
    expect(
      view.getByRole("link", { name: PROJECTS_COPY.openProject("Other App") }),
    ).toBeTruthy();
    // One title per screen (G1): the page heading names the project, so the
    // pane holds no second heading and the chosen row says which one is open.
    expect(
      view
        .getByRole("link", { name: PROJECTS_COPY.openProject("Demo App") })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(view.container.querySelector(".projects-detail h2")).toBeNull();
  });

  it("offers the way back to the list from a project's pane", () => {
    const view = renderProjects("/projects/demo-app", [makeProject()]);

    const back = view.getByRole("link", { name: PROJECTS_COPY.backToList });
    expect(back.getAttribute("href")).toBe("/projects");
  });
});

describe("The project detail pane (#267)", () => {
  it("names the project, and says its tracker and repository in the subtitle", () => {
    const view = renderProjects("/projects/demo-app", [makeProject()]);

    // The pane names no title of its own (G1): the page heading names the
    // project. The subtitle answers which tracker and which repository.
    expect(view.container.querySelector(".projects-detail h2")).toBeNull();
    expect(
      view.container.querySelector(".projects-detail-subtitle")?.textContent,
    ).toBe("Tracker One · Demo App");
    // General is the default tab: the project's name and identifier, once.
    const facts = factsOf(view.container);
    expect(facts.get(PROJECT_DETAIL_COPY.projectName)).toBe("Demo App");
    expect(facts.get(PROJECT_DETAIL_COPY.projectId)).toBe("demo-app");
    expect(view.container.textContent).not.toContain("Workspace Path");
  });

  it("names the folder a project is checked out in when it records no repository", () => {
    const view = renderProjects("/projects/demo-app", [
      makeProject({ repositories: [] }),
    ]);

    expect(
      view.container.querySelector(".projects-detail-subtitle")?.textContent,
    ).toContain("/work/demo-app");
  });

  it("names the tracker's own project in the subtitle when the provider describes it", async () => {
    const original = api.providers.describe;
    api.providers.describe = (async (payload: { providerId: string }) => ({
      providerId: payload.providerId,
      identity: payload.providerId === "tracker-one" ? "acme/Converso" : null,
    })) as typeof api.providers.describe;
    try {
      const view = renderProjects("/projects/demo-app", [makeProject()]);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(
        view.container.querySelector(".projects-detail-subtitle")?.textContent,
      ).toBe("Tracker One · acme/Converso");
    } finally {
      api.providers.describe = original;
    }
  });

  it("says Not recorded when the project records neither a repository nor a folder", () => {
    const view = renderProjects("/projects/demo-app", [
      makeProject({ repositories: [], workspacePath: "", repositoryPath: "" }),
    ]);

    expect(
      view.container.querySelector(".projects-detail-subtitle")?.textContent,
    ).toContain(PROJECTS_COPY.noRepository);
  });

  it("puts the archived badge beside the subtitle, in the pane header", () => {
    const view = renderProjects("/projects/demo-app", [
      makeProject({ archived: true }),
    ]);

    expect(
      view.container.querySelector(
        ".projects-detail-header .projects-detail-status",
      ),
    ).not.toBeNull();
  });

  it("says a project with no repositories in an empty state, on the Repositories tab", () => {
    const view = renderProjects("/projects/demo-app?tab=repositories", [
      makeProject({ repositories: [] }),
    ]);

    const region = view.container.querySelector("#project-detail-repos-table");
    expect(region?.querySelector(".ui-empty-state")).not.toBeNull();
    expect(region?.textContent).toContain(
      PROJECT_DETAIL_COPY.repositoriesEmpty,
    );
  });

  it("marks an archived project as archived", () => {
    const view = renderProjects("/projects/demo-app", [
      makeProject({ archived: true }),
    ]);

    expect(view.container.textContent).toContain(PROJECT_DETAIL_COPY.archived);
  });

  it("says a project the catalog does not contain, with the way back", () => {
    const view = renderProjects("/projects/deleted-app", [makeProject()]);

    expect(view.container.textContent).toContain(
      PROJECT_DETAIL_COPY.notFound("deleted-app"),
    );
    expect(
      view.getByRole("button", {
        name: new RegExp(PROJECT_DETAIL_COPY.backToProjects),
      }),
    ).toBeTruthy();
  });

  it("says what a selection shows while the list route has no project", () => {
    const view = renderProjects("/projects", [makeProject()]);

    expect(view.container.textContent).toContain(PROJECTS_COPY.selectPrompt);
    expect(
      view.queryByRole("heading", { level: 2, name: "Demo App" }),
    ).toBeNull();
  });
});

/** Types like a user: react-dom's value watcher needs focus and a keyup. */
function typeInto(el: HTMLElement, value: string) {
  act(() => {
    el.focus();
    fireEvent.change(el, { target: { value } });
    fireEvent.keyUp(el);
  });
}

describe("The project pane's tabs live in the URL", () => {
  const TWO_REPOS = [
    {
      id: "web",
      name: "web",
      path: "/work/web",
      defaultBranch: "main",
      role: "frontend",
    },
    {
      id: "api",
      name: "api",
      path: "/work/api",
      defaultBranch: "develop",
      role: "backend",
    },
  ] as Project["repositories"];

  function currentSearch(router: { state: { location: { search: string } } }) {
    return router.state.location.search;
  }

  it("opens on General, and a ?tab link opens that tab", () => {
    const general = renderProjects("/projects/demo-app", [makeProject()]);
    expect(
      general.container.querySelector(".projects-detail-fact"),
    ).not.toBeNull();
    expect(
      general.container.querySelector("#project-connections-combo"),
    ).toBeNull();
    cleanup();

    const connection = renderProjects("/projects/demo-app?tab=connection", [
      makeProject(),
    ]);
    expect(
      connection.container.querySelector("#project-connections-combo"),
    ).not.toBeNull();
    expect(
      connection.container.querySelector(".projects-detail-fact"),
    ).toBeNull();
    // The connection is named once: the tracker card does not repeat the line.
    expect(
      connection.container.querySelectorAll(".connection-combo-slot--tracker"),
    ).toHaveLength(1);
  });

  it("switching tab writes it to the URL, and shows the readiness banner on every tab", () => {
    const view = renderProjects("/projects/demo-app", [makeProject()]);

    fireEvent.click(
      view.getByRole("radio", {
        name: new RegExp(PROJECT_DETAIL_COPY.tabConnection),
      }),
    );
    expect(currentSearch(view.router)).toBe("?tab=connection");
    expect(
      view.container.querySelector("#project-connections-combo"),
    ).not.toBeNull();

    fireEvent.click(
      view.getByRole("radio", {
        name: new RegExp(PROJECT_DETAIL_COPY.tabRepositories),
      }),
    );
    expect(currentSearch(view.router)).toBe("?tab=repositories");
  });

  it("the Repositories tab shows only the selected repository's form, and selecting writes ?repo", () => {
    const view = renderProjects("/projects/demo-app?tab=repositories", [
      makeProject({ repositories: TWO_REPOS }),
    ]);

    expect(document.getElementById("repo-settings-web-path")).not.toBeNull();
    expect(document.getElementById("repo-settings-api-path")).toBeNull();
    const rows = view.getAllByRole("button", { name: /^(web|api)/ });
    expect(rows[0]?.getAttribute("aria-current")).toBe("true");
    expect(rows[1]?.getAttribute("aria-current")).not.toBe("true");

    fireEvent.click(rows[1] as HTMLElement);
    expect(currentSearch(view.router)).toBe("?tab=repositories&repo=api");
    expect(document.getElementById("repo-settings-api-path")).not.toBeNull();
    expect(document.getElementById("repo-settings-web-path")).toBeNull();
  });

  it("a ?repo link opens that repository", () => {
    renderProjects("/projects/demo-app?tab=repositories&repo=api", [
      makeProject({ repositories: TWO_REPOS }),
    ]);
    expect(document.getElementById("repo-settings-api-path")).not.toBeNull();
  });

  it("the filter narrows the list of repositories by name", () => {
    const view = renderProjects("/projects/demo-app?tab=repositories", [
      makeProject({ repositories: TWO_REPOS }),
    ]);
    const filter = view.getByRole("textbox", { name: "Filter repositories" });
    typeInto(filter, "ap");
    const list = view.getByRole("list", { name: "Repositories" });
    expect(list.textContent).toContain("api");
    expect(list.textContent).not.toContain("web");
  });

  it("Save stays disabled until the repository's form changes", () => {
    renderProjects("/projects/demo-app?tab=repositories", [
      makeProject({ repositories: TWO_REPOS }),
    ]);
    const save = document.getElementById("repo-settings-web-save");
    expect(save?.hasAttribute("disabled")).toBe(true);
    const test = document.getElementById("repo-settings-web-test");
    if (!test) throw new Error("missing field");
    typeInto(test, "bun test");
    expect(save?.hasAttribute("disabled")).toBe(false);
  });
});

describe('Wording on the Projects screens (#267, CONTEXT.md "UI wording")', () => {
  /** The words that must never reach a screen. */
  const INTERNAL_VOCABULARY = /\b(operator|factory|ralph|pipeline)\b/i;

  for (const path of ["/projects", "/projects/demo-app"]) {
    it(`${path} never names the operator, the factory, Ralph or the pipeline`, () => {
      const view = renderProjects(path, [
        makeProject(),
        makeProject({ id: "old", name: "Old App", archived: true }),
      ]);

      expect(view.container.textContent ?? "").not.toMatch(INTERNAL_VOCABULARY);
    });
  }

  it("the action is Add Project, and the General tab names the project and its identifier", () => {
    const shell = renderShell("/projects");
    expect(
      shell.getByRole("button", { name: PROJECTS_COPY.addProject }),
    ).toBeTruthy();
    cleanup();

    const detail = renderProjects("/projects/demo-app", [makeProject()]);
    expect([...factsOf(detail.container).keys()]).toEqual([
      PROJECT_DETAIL_COPY.projectName,
      PROJECT_DETAIL_COPY.projectId,
    ]);
  });
});

describe("Add Project is reachable from the Projects screens (#267)", () => {
  it("offers Add Project on the first run, and it opens the assistant", () => {
    const view = renderProjects("/projects", []);

    expect(view.getByRole("status").textContent).toContain(PROJECTS_COPY.empty);
    expect(view.queryByRole("dialog")).toBeNull();

    fireEvent.click(
      view.getByRole("button", { name: PROJECTS_COPY.addProject }),
    );

    expect(view.getByRole("dialog", { name: WIZARD_COPY.title })).toBeTruthy();
  });

  it("the first run's empty state is not shown once a project exists", () => {
    const view = renderProjects("/projects", [makeProject()]);

    expect(view.container.textContent).not.toContain(PROJECTS_COPY.empty);
    expect(
      view.queryByRole("button", { name: PROJECTS_COPY.addProject }),
    ).toBeNull();
  });

  for (const path of ["/projects", "/projects/demo-app"]) {
    it(`the toolbar's Add Project opens the assistant on ${path}`, () => {
      const view = renderShell(path);

      fireEvent.click(
        view.getByRole("button", { name: PROJECTS_COPY.addProject }),
      );

      expect(
        view.getByRole("dialog", { name: WIZARD_COPY.title }),
      ).toBeTruthy();
    });
  }
});
