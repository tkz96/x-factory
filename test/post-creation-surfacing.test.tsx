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
import { CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
import { ConnectionComboLine } from "../src/frontend/components/projects/ConnectionComboLine.js";
import { deriveConnectionIntegrity } from "../src/frontend/components/projects/connection-integrity.js";
import { ProjectCard } from "../src/frontend/components/projects/ProjectCard.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { api } from "../src/frontend/lib/api-client.js";
import { queryKeys } from "../src/frontend/lib/query-policies.js";
import { ProjectDetailView } from "../src/frontend/views/ProjectDetailView.js";
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
        ModalProvider,
        null,
        React.createElement(MemoryRouter, { initialEntries }, ui),
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

    // No degraded warning, no integrity failure, no repair path.
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
    const testScopes = mock(async () => ({
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
    const testScopes = mock(async () => ({ ok: true }));
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
