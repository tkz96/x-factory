// test/post-creation-surfacing.test.tsx — Post-creation connection surfacing
// (spec #133, ticket #147), behavioural coverage per surface.
//
// Follows test/frontend-views-feedback.test.tsx and test/repositories-step.tsx:
// the REAL components and views are rendered, and the ONLY mocked module is the
// api-client seam. Each of the four surfaces that render project connections —
// the project detail surface (header + tracker card), the settings connections
// registry, the project cards, and the Work Queue — is asserted through the
// three states of the state matrix (healthy / degraded / integrity failure),
// using the feedback primitives.
//
// Assertions read the rendered DOM (roles, text, classes) and the api-client
// calls the surface makes. Nothing here reaches into a child component or hook.

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
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  CONNECTIONS_COPY,
  PROJECT_CARD_COPY,
  PROJECT_DETAIL_COPY,
  QUEUE_COPY,
} from "../src/frontend/components/feedback/copy-map.js";
import { ConnectionComboLine } from "../src/frontend/components/projects/ConnectionComboLine.js";
import { deriveConnectionIntegrity } from "../src/frontend/components/projects/connection-integrity.js";
import { ProjectCard } from "../src/frontend/components/projects/ProjectCard.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ProjectProvider } from "../src/frontend/context/ProjectContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { ProjectDetailView } from "../src/frontend/views/ProjectDetailView.js";
import { QueueView } from "../src/frontend/views/QueueView.js";
import { SettingsView } from "../src/frontend/views/SettingsView.js";
import type { Project } from "../src/shared/types.js";

afterAll(async () => {
  cleanup();
  await unregisterHappyDom();
});

/** Three providers, as the manifest publishes them. */
const MANIFEST: ProviderDescriptor[] = [
  {
    id: "tracker-one",
    displayName: "Tracker One",
    roles: ["tracker"],
    iconRef: "icon-tracker-one",
    capabilities: ["listTickets", "verifyScopes"],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
      { name: "email", label: "Email", type: "email", required: true },
      {
        name: "apiToken",
        label: "API Token",
        type: "secret",
        required: true,
        secret: true,
      },
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
      { name: "repo", label: "Repository", type: "text", required: true },
    ],
  },
  {
    // Declares no capabilities at all: nothing capability-driven may render.
    id: "plain-tracker",
    displayName: "Plain Tracker",
    roles: ["tracker"],
    iconRef: "icon-plain-tracker",
    capabilities: [],
    configFields: [
      { name: "host", label: "Host", type: "url", required: true },
    ],
  },
];

/** Both connections healthy and complete. */
const HEALTHY_CONNECTIONS = [
  {
    providerId: "tracker-one",
    roles: ["tracker" as const],
    config: { host: "https://tracker.example", email: "dev@example.com" },
  },
  {
    providerId: "githost-one",
    roles: ["gitHost" as const],
    config: { orgUrl: "https://git.example", repo: "rocket" },
  },
];

/** Tracker present but its required configuration is not recorded. */
const DEGRADED_CONNECTIONS = [
  {
    providerId: "tracker-one",
    roles: ["tracker" as const],
    config: { host: "https://tracker.example" },
  },
  {
    providerId: "githost-one",
    roles: ["gitHost" as const],
    config: { orgUrl: "https://git.example", repo: "rocket" },
  },
];

/** No connection serves the tracker role: the integrity failure. */
const NO_TRACKER_CONNECTIONS = [
  {
    providerId: "githost-one",
    roles: ["gitHost" as const],
    config: { orgUrl: "https://git.example", repo: "rocket" },
  },
];

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "proj-1",
    name: "Rocket",
    repositoryPath: "/work/rocket",
    defaultBranch: "main",
    testCommand: "bun test",
    repositories: [],
    issueTracker: { provider: "tracker-one" },
    connections: HEALTHY_CONNECTIONS,
    ...overrides,
  } as Project;
}

function makeClient(): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(queryKeys.providers(), MANIFEST);
  return client;
}

function renderUi(
  ui: React.ReactElement,
  client: QueryClient,
  initialEntries: string[] = ["/"],
) {
  return render(
    React.createElement(
      QueryClientProvider,
      { client },
      React.createElement(
        ProjectProvider,
        null,
        React.createElement(
          ModalProvider,
          null,
          React.createElement(MemoryRouter, { initialEntries }, ui),
        ),
      ),
    ),
  );
}

/** Probes the modal context so a repair action's effect is observable. */
function OnboardingProbe() {
  const { isOnboardingOpen } = useModal();
  return (
    <span data-testid="onboarding-probe">
      {isOnboardingOpen ? "onboarding-open" : "onboarding-closed"}
    </span>
  );
}

beforeEach(() => {
  api.providers.getManifest = mock(async () => MANIFEST);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});
describe("ConnectionComboLine — the git host + tracker combo (#147)", () => {
  it("renders both roles with manifest display names and the connected tone", () => {
    const integrity = deriveConnectionIntegrity(makeProject(), MANIFEST);
    const { container } = renderUi(
      React.createElement(ConnectionComboLine, {
        integrity,
        descriptors: MANIFEST,
      }),
      makeClient(),
    );

    const line = container.querySelector(".connection-combo-line");
    expect(line?.classList.contains("connection-combo-line--connected")).toBe(
      true,
    );
    expect(container.textContent).toContain(CONNECTIONS_COPY.roleLabel.tracker);
    expect(container.textContent).toContain(CONNECTIONS_COPY.roleLabel.gitHost);
    expect(container.textContent).toContain("Tracker One");
    expect(container.textContent).toContain("Git Host One");
    expect(container.textContent).not.toContain("tracker-one");
    expect(
      container.querySelector(".connection-combo-slot--degraded"),
    ).toBeNull();
  });

  it("renders a degraded slot in the warning tone, never the error tone", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({ connections: DEGRADED_CONNECTIONS }),
      MANIFEST,
    );
    const { container } = renderUi(
      React.createElement(ConnectionComboLine, {
        integrity,
        descriptors: MANIFEST,
      }),
      makeClient(),
    );

    expect(
      container
        .querySelector(".connection-combo-line")
        ?.classList.contains("connection-combo-line--warning"),
    ).toBe(true);
    expect(
      container.querySelector(".connection-combo-slot--degraded")?.textContent,
    ).toContain(CONNECTIONS_COPY.stateLabel.degraded);
    expect(container.querySelector(".connection-combo-line--error")).toBeNull();
  });

  it("renders a missing role as not recorded in the error tone", () => {
    const integrity = deriveConnectionIntegrity(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
      MANIFEST,
    );
    const { container } = renderUi(
      React.createElement(ConnectionComboLine, {
        integrity,
        descriptors: MANIFEST,
      }),
      makeClient(),
    );

    expect(
      container
        .querySelector(".connection-combo-line")
        ?.classList.contains("connection-combo-line--error"),
    ).toBe(true);
    const trackerSlot = container.querySelector(
      ".connection-combo-slot--disconnected",
    );
    expect(trackerSlot?.textContent).toContain(CONNECTIONS_COPY.notRecorded);
    expect(trackerSlot?.textContent).toContain(
      CONNECTIONS_COPY.stateLabel.disconnected,
    );
  });

  it("resolves any registered provider from the manifest — no id to name table", () => {
    const gitlab: ProviderDescriptor = {
      id: "gitlab-later",
      displayName: "GitLab Issues",
      roles: ["tracker"],
      iconRef: "icon-gitlab",
      capabilities: ["listTickets"],
      configFields: [
        { name: "host", label: "Host", type: "url", required: true },
      ],
    };
    const integrity = deriveConnectionIntegrity(
      makeProject({
        connections: [
          {
            providerId: "gitlab-later",
            roles: ["tracker"],
            config: { host: "https://gitlab.example" },
          },
        ],
      }),
      [gitlab],
    );
    const { container } = renderUi(
      React.createElement(ConnectionComboLine, {
        integrity,
        descriptors: [gitlab],
      }),
      makeClient(),
    );

    expect(container.textContent).toContain("GitLab Issues");
    expect(container.textContent).not.toContain("gitlab-later");
  });

  it("restricts the rendered slots to the requested roles", () => {
    const integrity = deriveConnectionIntegrity(makeProject(), MANIFEST);
    const { container } = renderUi(
      React.createElement(ConnectionComboLine, {
        integrity,
        descriptors: MANIFEST,
        roles: ["tracker"],
      }),
      makeClient(),
    );

    expect(
      container.querySelector(".connection-combo-slot--tracker"),
    ).not.toBeNull();
    expect(
      container.querySelector(".connection-combo-slot--gitHost"),
    ).toBeNull();
  });
});

// ─── Project detail surface (header combo line + tracker card) ───────────────

function renderDetail(project: Project, client: QueryClient) {
  client.setQueryData(queryKeys.projects(), [project]);
  client.setQueryData(queryKeys.readiness(), { ready: true, checks: [] });
  return renderUi(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/projects/:id",
        element: React.createElement(ProjectDetailView),
      }),
      React.createElement(Route, {
        path: "/settings",
        element: React.createElement(
          "div",
          { id: "settings-route" },
          "Connections",
        ),
      }),
    ),
    client,
    ["/projects/proj-1"],
  );
}

describe("Project detail surface — combo line and tracker card", () => {
  it("HEALTHY: renders the combo line in the header with both manifest names", () => {
    const { container } = renderDetail(makeProject(), makeClient());

    const combo = container.querySelector("#project-connections-combo");
    expect(combo?.classList.contains("connection-combo-line--connected")).toBe(
      true,
    );
    expect(combo?.textContent).toContain("Tracker One");
    expect(combo?.textContent).toContain("Git Host One");
    expect(combo?.textContent).not.toContain("tracker-one");

    // The tracker card renders the recorded configuration with manifest
    // labels, plus the workflow label the queue ingests on.
    expect(container.textContent).toContain("https://tracker.example");
    expect(container.textContent).toContain(CONNECTIONS_COPY.ingestionLabel);
    expect(container.textContent).toContain(CONNECTIONS_COPY.workflowLabel);

    // No degraded warning, no integrity failure, no repair path.
    expect(container.textContent).toContain(PROJECT_DETAIL_COPY.projectId);
    expect(container.querySelector(".feedback-banner--warning")).toBeNull();
    expect(container.querySelector(".async-region--error")).toBeNull();
    expect(container.querySelector("button.retry-action")).toBeNull();
  });

  it("DEGRADED: warns about the incomplete connection, without the error tone", () => {
    const { container } = renderDetail(
      makeProject({ connections: DEGRADED_CONNECTIONS }),
      makeClient(),
    );

    expect(
      container
        .querySelector("#project-connections-combo")
        ?.classList.contains("connection-combo-line--warning"),
    ).toBe(true);
    const warnings = container.querySelector(".feedback-banner--warning");
    expect(warnings).not.toBeNull();
    // The missing field is named by its manifest label, not a raw key.
    expect(warnings?.textContent).toContain("Email");
    expect(container.querySelector(".async-region--error")).toBeNull();
    expect(container.querySelector("button.retry-action")).toBeNull();
  });

  it("INTEGRITY FAILURE: renders the repair path and never an empty state", () => {
    const { container } = renderDetail(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
      makeClient(),
    );

    expect(
      container
        .querySelector("#project-connections-combo")
        ?.classList.contains("connection-combo-line--error"),
    ).toBe(true);

    const failure = container.querySelector(".async-region--error");
    expect(failure?.textContent).toContain(
      CONNECTIONS_COPY.integrityFailure.message,
    );
    const repair = container.querySelector("button.retry-action");
    expect(repair?.textContent).toContain(CONNECTIONS_COPY.reconnect);

    // A project without a tracker is an integrity failure, never a
    // successfully-empty region.
    expect(container.querySelector(".async-region--empty")).toBeNull();
  });

  it("INTEGRITY FAILURE: the repair action reaches the connections surface", () => {
    const { container } = renderDetail(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
      makeClient(),
    );

    const repair = container.querySelector("button.retry-action");
    if (!(repair instanceof HTMLElement)) {
      throw new Error("repair action missing");
    }
    fireEvent.click(repair);

    expect(container.querySelector("#settings-route")).not.toBeNull();
  });
});

describe("Tracker card — capability-driven diagnostics (#147)", () => {
  it("renders the scope diagnostic when the connection declares the capability", async () => {
    const testScopes = mock(async (_payload: { projectId?: string }) => ({
      ok: true,
      overPrivileged: true,
      scopes: { listTickets: true },
    }));
    api.testAzureScopes = testScopes as never;

    const { container } = renderDetail(makeProject(), makeClient());
    const action = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === CONNECTIONS_COPY.verifyScopes,
    );
    if (!(action instanceof HTMLElement)) {
      throw new Error("capability-driven scope action missing");
    }

    await act(async () => {
      fireEvent.click(action);
    });

    expect(testScopes).toHaveBeenCalledTimes(1);
    expect(testScopes.mock.calls[0]?.[0]).toEqual({ projectId: "proj-1" });
    await waitFor(() => {
      if (!container.textContent?.includes(CONNECTIONS_COPY.verifyScopesOk)) {
        throw new Error("verification result missing");
      }
    });
    expect(container.textContent).toContain(CONNECTIONS_COPY.overPrivileged);
  });

  it("renders no capability-driven action when the connection declares none", () => {
    const testScopes = mock(async (_payload: { projectId?: string }) => ({
      ok: true,
    }));
    api.testAzureScopes = testScopes as never;

    const { container } = renderDetail(
      makeProject({
        connections: [
          {
            providerId: "plain-tracker",
            roles: ["tracker"],
            config: { host: "https://plain.example" },
          },
          {
            providerId: "githost-one",
            roles: ["gitHost"],
            config: { orgUrl: "https://git.example", repo: "rocket" },
          },
        ],
      }),
      makeClient(),
    );

    expect(container.querySelector(".project-tracker-card")).not.toBeNull();
    expect(container.textContent).toContain("Plain Tracker");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (button) => button.textContent === CONNECTIONS_COPY.verifyScopes,
      ),
    ).toBe(false);
    expect(testScopes).toHaveBeenCalledTimes(0);
  });
});

// ─── Project cards ──────────────────────────────────────────────────────────

function renderCard(project: Project, isArchived = false) {
  return renderUi(
    React.createElement(ProjectCard, { project, isArchived }),
    makeClient(),
    ["/projects"],
  );
}

describe("Project card — combo line and integrity failure", () => {
  it("HEALTHY: renders the combo line with manifest display names", () => {
    const { container } = renderCard(makeProject());

    const combo = container.querySelector(".connection-combo-line");
    expect(combo?.classList.contains("connection-combo-line--connected")).toBe(
      true,
    );
    expect(combo?.textContent).toContain("Tracker One");
    expect(combo?.textContent).toContain("Git Host One");
    // The provider id is never the label when the manifest names the provider.
    expect(combo?.textContent).not.toContain("tracker-one");
    expect(container.querySelector("button.retry-action")).toBeNull();
    // Every string on the card comes from the copy map.
    expect(container.textContent).toContain(PROJECT_CARD_COPY.viewDetails);
    expect(container.textContent).toContain(PROJECT_CARD_COPY.id);
  });

  it("DEGRADED: renders the warning tone and no repair path", () => {
    const { container } = renderCard(
      makeProject({ connections: DEGRADED_CONNECTIONS }),
    );

    expect(
      container
        .querySelector(".connection-combo-line")
        ?.classList.contains("connection-combo-line--warning"),
    ).toBe(true);
    expect(container.querySelector(".connection-combo-line--error")).toBeNull();
    expect(container.querySelector(".async-region--error")).toBeNull();
  });

  it("INTEGRITY FAILURE: renders the error tone with the repair path", () => {
    const { container } = renderCard(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
    );

    expect(
      container
        .querySelector(".connection-combo-line")
        ?.classList.contains("connection-combo-line--error"),
    ).toBe(true);
    const repair = container.querySelector("button.retry-action");
    expect(repair?.textContent).toContain(CONNECTIONS_COPY.reconnect);
    expect(container.querySelector(".async-region--empty")).toBeNull();
  });

  it("INTEGRITY FAILURE: the repair path never nests inside the card's link", () => {
    const { container } = renderCard(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
    );

    const repair = container.querySelector("button.retry-action");
    if (!(repair instanceof HTMLElement)) {
      throw new Error("repair action missing");
    }
    // An interactive element inside the card's anchor would be invalid HTML.
    expect(repair.closest("a")).toBeNull();
    expect(
      container.querySelector('a[href="/projects/proj-1"]'),
    ).not.toBeNull();
  });

  it("LEGACY: a pre-#145 project still renders a combo line", () => {
    const { container } = renderCard(
      makeProject({
        connections: undefined,
        issueTracker: {
          provider: "tracker-one",
          "tracker-one": { host: "https://legacy.example" },
        } as unknown as Project["issueTracker"],
      }),
    );

    const combo = container.querySelector(".connection-combo-line");
    expect(combo).not.toBeNull();
    // Git host unknown is shown as not recorded, never invented.
    expect(combo?.textContent).toContain(CONNECTIONS_COPY.notRecorded);
    expect(combo?.classList.contains("connection-combo-line--warning")).toBe(
      true,
    );
  });
});

// ─── Settings connections registry ──────────────────────────────────────────

/** Opens the settings Connections tab and returns the registry container. */
async function renderConnectionsRegistry(
  projects: Project[],
  client: QueryClient,
): Promise<HTMLElement> {
  client.setQueryData(queryKeys.projects(), projects);
  const { container } = renderUi(
    React.createElement(
      React.Fragment,
      null,
      React.createElement(SettingsView),
      React.createElement(OnboardingProbe),
    ),
    client,
  );

  const tab = Array.from(container.querySelectorAll("button")).find(
    (button) => button.dataset.tab === "trackers",
  );
  if (!(tab instanceof HTMLElement)) {
    throw new Error("connections tab missing");
  }
  await act(async () => {
    fireEvent.click(tab);
  });
  return container;
}

describe("Settings connections registry — combo line per project", () => {
  it("HEALTHY: renders the combo line for a project with both connections", async () => {
    const container = await renderConnectionsRegistry(
      [makeProject()],
      makeClient(),
    );

    const row = container.querySelector("#connections-registry-tbody tr");
    expect(row?.textContent).toContain("Tracker One");
    expect(row?.textContent).toContain("Git Host One");
    expect(row?.textContent).not.toContain("tracker-one");
    expect(
      row?.querySelector(".connection-combo-line--connected"),
    ).not.toBeNull();
  });

  it("DEGRADED: renders the warning tone without a repair path", async () => {
    const container = await renderConnectionsRegistry(
      [makeProject({ connections: DEGRADED_CONNECTIONS })],
      makeClient(),
    );

    const row = container.querySelector("#connections-registry-tbody tr");
    expect(
      row?.querySelector(".connection-combo-line--warning"),
    ).not.toBeNull();
    expect(row?.querySelector(".connection-combo-line--error")).toBeNull();
    expect(row?.querySelector("button.retry-action")).toBeNull();
  });

  it("INTEGRITY FAILURE: renders the repair path that opens the connection flow", async () => {
    const container = await renderConnectionsRegistry(
      [makeProject({ connections: NO_TRACKER_CONNECTIONS })],
      makeClient(),
    );

    const row = container.querySelector("#connections-registry-tbody tr");
    expect(row?.querySelector(".connection-combo-line--error")).not.toBeNull();
    const repair = row?.querySelector("button.retry-action");
    expect(repair?.textContent).toContain(CONNECTIONS_COPY.reconnect);

    expect(
      container.querySelector('[data-testid="onboarding-probe"]')?.textContent,
    ).toBe("onboarding-closed");
    if (!(repair instanceof HTMLElement)) {
      throw new Error("repair action missing");
    }
    await act(async () => {
      fireEvent.click(repair);
    });
    expect(
      container.querySelector('[data-testid="onboarding-probe"]')?.textContent,
    ).toBe("onboarding-open");
  });
});

describe("Settings connections registry — canonical copy", () => {
  it("renders the registry title and its columns from the copy map", async () => {
    const container = await renderConnectionsRegistry(
      [makeProject()],
      makeClient(),
    );

    expect(container.textContent).toContain(CONNECTIONS_COPY.registryTitle);
    expect(container.textContent).toContain(
      CONNECTIONS_COPY.registryColumnConnections,
    );
    expect(container.textContent).toContain(CONNECTIONS_COPY.registryAction);
  });
});

// ─── Work Queue ─────────────────────────────────────────────────────────────

function makeTicket(id: string) {
  return {
    id,
    title: `${id} title`,
    acceptanceCriteria: [],
    url: `https://tickets.example/${id}`,
    provider: "tracker-one",
  } as Parameters<
    typeof import("../src/frontend/components/queue/TicketCard.js").TicketCard
  >[0]["ticket"];
}

async function renderQueue(
  project: Project,
  tickets: ReturnType<typeof makeTicket>[],
) {
  const client = makeClient();
  client.setQueryData(queryKeys.projects(), [project]);
  client.setQueryData(queryKeys.tickets(project.id), tickets);
  api.getTickets = mock(async () => tickets) as never;

  const rendered = renderUi(
    React.createElement(
      Routes,
      null,
      React.createElement(Route, {
        path: "/queue",
        element: React.createElement(QueueView),
      }),
      React.createElement(Route, {
        path: "/settings",
        element: React.createElement(
          "div",
          { id: "settings-route" },
          "Connections",
        ),
      }),
    ),
    client,
    ["/queue"],
  );
  await waitFor(() => {
    if (client.getQueryData(queryKeys.tickets(project.id)) === undefined) {
      throw new Error("tickets not in cache");
    }
  });
  return rendered;
}

describe("Work Queue — combo state matrix", () => {
  it("HEALTHY: lists the queue with no feedback chrome", async () => {
    const { container } = await renderQueue(makeProject(), [
      makeTicket("TICK-1"),
    ]);
    await waitFor(() => {
      if (!container.textContent?.includes("TICK-1")) {
        throw new Error("ticket missing");
      }
    });

    expect(container.querySelector(".async-region--error")).toBeNull();
    expect(container.querySelector(".feedback-banner--warning")).toBeNull();
    expect(container.querySelector("#queue-tickets-list")).not.toBeNull();
  });

  it("DEGRADED: warns about the connection while the queue stays visible", async () => {
    const { container } = await renderQueue(
      makeProject({ connections: DEGRADED_CONNECTIONS }),
      [makeTicket("TICK-2")],
    );
    await waitFor(() => {
      if (!container.textContent?.includes("TICK-2")) {
        throw new Error("ticket missing");
      }
    });

    const warnings = container.querySelector(".feedback-banner--warning");
    expect(warnings?.textContent).toContain("Email");
    expect(container.querySelector(".async-region--error")).toBeNull();
  });

  it("INTEGRITY FAILURE: is never rendered as an empty queue", async () => {
    const { container } = await renderQueue(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
      [],
    );

    await waitFor(() => {
      if (container.querySelector(".async-region--error") === null) {
        throw new Error("integrity failure missing");
      }
    });

    expect(container.textContent).toContain(
      CONNECTIONS_COPY.integrityFailure.message,
    );
    expect(
      container.querySelector("button.retry-action")?.textContent,
    ).toContain(CONNECTIONS_COPY.reconnect);
    // Never a successfully-empty queue, and never the dead-end copy.
    expect(container.querySelector(".async-region--empty")).toBeNull();
    expect(container.textContent).not.toContain(QUEUE_COPY.empty);
    // The manual path stays open.
    expect(container.textContent).toContain(QUEUE_COPY.manualRun);
  });

  it("INTEGRITY FAILURE: the repair action reaches the connections surface", async () => {
    const { container } = await renderQueue(
      makeProject({ connections: NO_TRACKER_CONNECTIONS }),
      [],
    );

    await waitFor(() => {
      if (container.querySelector("button.retry-action") === null) {
        throw new Error("repair action missing");
      }
    });
    const repair = container.querySelector("button.retry-action");
    if (!(repair instanceof HTMLElement)) {
      throw new Error("repair action missing");
    }
    await act(async () => {
      fireEvent.click(repair);
    });
    expect(container.querySelector("#settings-route")).not.toBeNull();
  });

  it("HEALTHY and empty: renders the honest empty queue, not an integrity failure", async () => {
    const { container } = await renderQueue(makeProject(), []);

    await waitFor(() => {
      if (container.querySelector(".async-region--empty") === null) {
        throw new Error("empty region missing");
      }
    });

    expect(container.textContent).toContain(QUEUE_COPY.empty);
    expect(container.textContent).not.toContain(
      CONNECTIONS_COPY.integrityFailure.message,
    );
  });
});

describe("Manifest-driven display names (#147)", () => {
  it("reads the providers manifest when no cached descriptors exist", async () => {
    const getManifest = mock(async () => MANIFEST);
    api.providers.getManifest = getManifest as never;

    // A cold client: nothing is cached, so the surface must fetch the manifest
    // to name the provider. No hardcoded id to name table may save it.
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { container } = renderUi(
      React.createElement(ProjectCard, { project: makeProject() }),
      client,
      ["/projects"],
    );

    await waitFor(() => {
      if (!container.textContent?.includes("Tracker One")) {
        throw new Error("manifest display name missing");
      }
    });
    expect(getManifest).toHaveBeenCalled();
    expect(container.textContent).not.toContain("tracker-one");
  });
});
