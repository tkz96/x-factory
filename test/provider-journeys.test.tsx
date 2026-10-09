// test/provider-journeys.test.tsx — the three onboarding journeys, written
// provider-agnostically (spec #133, ticket #148).
//
// Each journey runs the REAL wizard end to end — open, Basics, Connect (secrets
// through the provider's own `parseQuickUrl` URL shapes), Repositories (the
// provider's own repository listing), Inspection (the real git CLI), Review,
// Submit — against a REAL server. The only boundary that stands in is the
// transport module `src/frontend/lib/api-client.ts`: it is replaced by a client
// that performs real HTTP against the server the test started, so
// `POST /api/providers/parse-url`, `/verify`, `/repositories` and
// `POST /api/projects` all execute real server code, with a registry injected
// through the provider contract's own seam (`test/fixtures/journey-providers`).
//
// The provider under test is DATA. The driver below is parameterised by a
// fixture and contains no provider conditional, so a fourth provider is a
// fourth fixture entry — never a fourth branch.

/// <reference lib="dom" />
import { restoreNativeResponseGlobals } from "./fixtures/native-web-globals.js";
import { registerHappyDom, unregisterHappyDom } from "./setup-happy-dom.js";

registerHappyDom();
// The server below runs in THIS process: it must be able to build the runtime's
// own Responses, so the native fetch family is put back after registration.
restoreNativeResponseGlobals();

import { afterAll, afterEach, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ConnectionComboLine } from "../src/frontend/components/connections/ConnectionComboLine.js";
import { comboTone } from "../src/frontend/components/connections/connection-state.js";
import { CONNECTIONS_COPY } from "../src/frontend/components/feedback/copy-map.js";
import {
  comboSlots,
  deriveConnectionIntegrity,
  REQUIRED_CONNECTION_ROLES,
} from "../src/frontend/components/projects/connection-integrity.js";
import type { ProviderDescriptor } from "../src/frontend/connection/types.js";
import {
  ModalProvider,
  useModal,
} from "../src/frontend/context/ModalContext.js";
import { ApiError, api } from "../src/frontend/lib/api-client.js";
import { clearWizardDraft } from "../src/frontend/wizard/storage.js";
import { WizardModal } from "../src/frontend/wizard/WizardModal.js";
import { execStrict } from "../src/proc.js";
import { startServer } from "../src/server.js";
import {
  AZURE_DUAL_ROLE_JOURNEY,
  GITHUB_ONLY_JOURNEY,
  JIRA_TRACKER_ONLY_JOURNEY,
  type JourneyFixture,
  journeyRegistry,
  journeySecrets,
} from "./fixtures/journey-providers.js";

const savedEnv = {
  GIT_CONFIG_GLOBAL: process.env.GIT_CONFIG_GLOBAL,
  GIT_CONFIG_NOSYSTEM: process.env.GIT_CONFIG_NOSYSTEM,
  X_FACTORY_DATA_DIR: process.env.X_FACTORY_DATA_DIR,
  X_FACTORY_CONFIG_PATH: process.env.X_FACTORY_CONFIG_PATH,
  X_FACTORY_DB_PATH: process.env.X_FACTORY_DB_PATH,
};

function restoreEnv(key: keyof typeof savedEnv): void {
  const original = savedEnv[key];
  if (original === undefined) delete process.env[key];
  else process.env[key] = original;
}

/**
 * A workspace that is a real git repository configured with a real identity:
 * the Inspection step reads it through the same git CLI the executor's worktree
 * uses, so the identity the project is created with is resolved, not assumed.
 */
const WORKSPACE_IDENTITY = {
  name: "Journey Owner",
  email: "owner@example.com",
};
let workspacePath: string;
let baseDir: string;
let server: ReturnType<typeof startServer>;
let baseUrl: string;

beforeAll(async () => {
  baseDir = await mkdtemp(path.join(tmpdir(), "xf-journey-"));
  workspacePath = path.join(baseDir, "workspace");

  // The identity must come from the repository's own configuration: a global
  // gitconfig on the machine running the suite must not decide it.
  const emptyGlobalConfig = path.join(baseDir, "empty-gitconfig");
  await writeFile(emptyGlobalConfig, "");
  process.env.GIT_CONFIG_GLOBAL = emptyGlobalConfig;
  process.env.GIT_CONFIG_NOSYSTEM = "1";

  // Runtime state, secrets and the project record all land in the temp dir.
  process.env.X_FACTORY_DATA_DIR = path.join(baseDir, "data");
  process.env.X_FACTORY_CONFIG_PATH = path.join(
    baseDir,
    "config",
    "projects.json",
  );
  process.env.X_FACTORY_DB_PATH = path.join(baseDir, "xf.db");

  await execStrict("git", ["init", workspacePath], { envPolicy: "inherit" });
  await execStrict("git", ["config", "user.name", WORKSPACE_IDENTITY.name], {
    envPolicy: "inherit",
    cwd: workspacePath,
  });
  await execStrict("git", ["config", "user.email", WORKSPACE_IDENTITY.email], {
    envPolicy: "inherit",
    cwd: workspacePath,
  });
});

afterAll(async () => {
  if (server) {
    await server.shutdown();
  }
  restoreEnv("GIT_CONFIG_GLOBAL");
  restoreEnv("GIT_CONFIG_NOSYSTEM");
  restoreEnv("X_FACTORY_DATA_DIR");
  restoreEnv("X_FACTORY_CONFIG_PATH");
  restoreEnv("X_FACTORY_DB_PATH");
  await rm(baseDir, { recursive: true, force: true });
  await unregisterHappyDom();
});
// ---------------------------------------------------------------------------
// The api-client seam: replaced by real HTTP against the started server
// ---------------------------------------------------------------------------

interface TransportLog {
  /** Every body the client RECEIVED, as text — the "no secret" surface. */
  readonly received: string[];
  /** Every request the client SENT, with its path. */
  readonly sent: Array<{ readonly path: string; readonly body: string }>;
}

const ORIGINAL_API = {
  getManifest: api.providers.getManifest,
  verify: api.providers.verify,
  parseUrl: api.providers.parseUrl,
  listRepositories: api.providers.listRepositories,
  inspectRepository: api.inspectRepository,
  createProject: api.createProject,
  getProjects: api.getProjects,
  getProject: api.getProject,
};

function restoreApi(): void {
  api.providers.getManifest = ORIGINAL_API.getManifest;
  api.providers.verify = ORIGINAL_API.verify;
  api.providers.parseUrl = ORIGINAL_API.parseUrl;
  api.providers.listRepositories = ORIGINAL_API.listRepositories;
  api.inspectRepository = ORIGINAL_API.inspectRepository;
  api.createProject = ORIGINAL_API.createProject;
  api.getProjects = ORIGINAL_API.getProjects;
  api.getProject = ORIGINAL_API.getProject;
}

/** Points the api-client seam at the server the journey is running against. */
function installRealApiClient(): TransportLog {
  const log: TransportLog = { received: [], sent: [] };

  const call = async <T,>(requestPath: string, init?: RequestInit) => {
    const body = init?.body === undefined ? undefined : String(init.body);
    if (body !== undefined) {
      log.sent.push({ path: requestPath, body });
    }
    const res = await fetch(`${baseUrl}${requestPath}`, init);
    const text = await res.text();
    log.received.push(text);
    const parsed = text === "" ? undefined : JSON.parse(text);
    if (!res.ok) {
      const message =
        typeof (parsed as { error?: unknown })?.error === "string"
          ? ((parsed as { error: string }).error as string)
          : `API request failed with status ${res.status}`;
      throw new ApiError(message, res.status, parsed);
    }
    return parsed as T;
  };

  const post = (payload: unknown): RequestInit => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  api.providers.getManifest = ((role?: "tracker" | "gitHost") =>
    call<ProviderDescriptor[]>(
      `/api/providers/manifest${role ? `?role=${role}` : ""}`,
    )) as never;
  api.providers.verify = ((payload: unknown) =>
    call("/api/providers/verify", post(payload))) as never;
  api.providers.parseUrl = ((url: string) =>
    call("/api/providers/parse-url", post({ url }))) as never;
  api.providers.listRepositories = ((payload: unknown) =>
    call("/api/providers/repositories", post(payload))) as never;
  api.inspectRepository = ((payload: unknown) =>
    call("/api/projects/inspect-repository", post(payload))) as never;
  api.createProject = ((payload: unknown) =>
    call("/api/projects", post(payload))) as never;
  api.getProjects = (() => call("/api/projects")) as never;
  api.getProject = ((id: string) =>
    call(`/api/projects/${encodeURIComponent(id)}`)) as never;

  return log;
}

// ---------------------------------------------------------------------------
// Wizard harness
// ---------------------------------------------------------------------------

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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Waits for the UI to reflect a server round trip. The reads in these journeys
 * go over real HTTP to a real server (and the inspection one shells out to
 * git), so a single tick is not a contract — this waits for the state the
 * journey is actually waiting on, and fails loudly if it never arrives.
 */
async function flushUntil(
  described: string,
  predicate: () => boolean,
): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (predicate()) return;
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 25));
    });
  }
  throw new Error(`Timed out waiting for: ${described}`);
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
  // No seeded provider manifest: the wizard reads it from the real server, so
  // the display names and config descriptors under test are the ones the
  // injected registry actually serves.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

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

/** The roles a connection can serve, in combo-line order. */
const ROLES = ["tracker", "gitHost"] as const;

/** A journey in progress: everything the driver needs to assert against. */
interface JourneyRun {
  readonly fixture: JourneyFixture;
  readonly transport: TransportLog;
  readonly descriptors: readonly ProviderDescriptor[];
}

/** Runs one journey end to end through the real wizard and the real server. */
async function runJourney(fixture: JourneyFixture): Promise<JourneyRun> {
  const transport = installRealApiClient();
  const descriptors = await api.providers.getManifest();
  renderWizard();
  fireEvent.click(getEl("btn-open-wizard"));

  // ── Basics ───────────────────────────────────────────────────────────────
  await typeInput(getEl("onboard-proj-name"), fixture.project.name);
  await typeInput(getEl("onboard-workspace-path"), workspacePath);
  fireEvent.click(getEl("btn-step-1-next"));
  expect(document.getElementById("onboard-step-2")).not.toBeNull();
  // The Connect step is only rendered once the manifest it renders from has
  // arrived from the server.
  await flushUntil("the Connect step and its provider manifest", () =>
    Boolean(document.getElementById("select-tracker-provider")),
  );

  // ── Connect: the paste runs through the provider that owns the URL shape ──
  await typeInput(getEl("connect-quick-url"), fixture.quickUrl);
  await act(async () => {
    fireEvent.click(getEl("btn-quick-url-submit"));
  });
  await flushUntil("the Quick-URL parse to fill the cards", () =>
    ROLES.every(
      (role) =>
        !fixture.filledRoles.includes(role) ||
        getEl<HTMLSelectElement>(`select-${role}-provider`).value !== "",
    ),
  );

  for (const role of ROLES) {
    const select = getEl<HTMLSelectElement>(`select-${role}-provider`);
    const expected = fixture.filledRoles.includes(role)
      ? fixture.roleProvider[role]
      : "";
    // The paste filled exactly the roles the provider serves — no more.
    expect(select.value).toBe(expected);
    if (!fixture.filledRoles.includes(role)) {
      act(() => {
        fireEvent.change(select, {
          target: { value: fixture.roleProvider[role] },
        });
      });
    }
    // A provider that does not declare this role is not offered for it: the
    // choice set is the manifest's, never a hardcoded list.
    const offered = [...select.options].map((option) => option.value);
    const cannotServe = descriptors
      .filter((descriptor) => !descriptor.roles.includes(role))
      .map((descriptor) => descriptor.id);
    for (const id of cannotServe) {
      expect(offered).not.toContain(id);
    }
    expect(offered).toContain(fixture.roleProvider[role]);
  }

  for (const field of fixture.typed) {
    await typeInput(getEl(`${field.role}-${field.field}`), field.value);
  }

  await act(async () => {
    fireEvent.click(getEl("btn-verify-all"));
  });
  await flush();

  // ── Connect: degraded evidence is shown, and NEVER blocks progression ────
  if (fixture.degraded !== null) {
    const { role, capability } = fixture.degraded;
    const card = getEl(`connection-card-${role}`);
    // The card names the capability that could not be confirmed, in contract
    // terms, in the partial state — never in provider scope terminology.
    expect(card.textContent).toContain(capability);
    expect(card.textContent).toContain("Degraded");
    // A degraded verification is usable (#133: "degraded renders the partial
    // state, never blocks progression"): there is no acknowledgement to make.
    expect(document.getElementById(`btn-accept-degraded-${role}`)).toBeNull();
    expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(false);
  }
  expect(getEl<HTMLButtonElement>("btn-step-2-next").disabled).toBe(false);
  fireEvent.click(getEl("btn-step-2-next"));
  expect(document.getElementById("onboard-step-3")).not.toBeNull();
  await flushUntil("the git host's repository listing", () =>
    Boolean(document.getElementById("repositories-list")),
  );

  // ── Repositories: discovery from the git host's own listing ─────────────
  const rows = getEl("repositories-list").querySelectorAll(
    ".repositories-list-item",
  );
  expect(rows.length).toBeGreaterThan(0);
  act(() => {
    fireEvent.click(getEl(`repo-select-${fixture.selectedRepositoryId}`));
  });
  expect(
    getEl<HTMLInputElement>(`repo-select-${fixture.selectedRepositoryId}`)
      .checked,
  ).toBe(true);
  fireEvent.click(getEl("btn-step-3-next"));
  expect(document.getElementById("onboard-step-4")).not.toBeNull();
  await flushUntil("the identity read from the inspected repository", () =>
    Boolean(document.getElementById("inspection-identity-name")),
  );

  // ── Inspection: the identity is read from the real repository ───────────
  expect(getEl("inspection-identity-name").textContent).toBe(
    WORKSPACE_IDENTITY.name,
  );
  expect(getEl("inspection-identity-email").textContent).toBe(
    WORKSPACE_IDENTITY.email,
  );
  fireEvent.click(getEl("btn-step-4-next"));
  expect(document.getElementById("onboard-step-5")).not.toBeNull();
  await flush();

  // ── Review: the combo line names the providers the manifest serves ──────
  const displayName = (providerId: string): string => {
    const descriptor = descriptors.find((entry) => entry.id === providerId);
    expect(descriptor).toBeDefined();
    return descriptor?.displayName ?? providerId;
  };
  for (const role of ROLES) {
    const providerId = fixture.roleProvider[role];
    expect(getEl(`combo-${role}-name`).textContent).toBe(
      displayName(providerId),
    );
    // A machine id is never what a user reads.
    expect(getEl("combo-summary").textContent).not.toContain(providerId);
  }
  expect(getEl<HTMLButtonElement>("btn-step-5-submit").disabled).toBe(false);

  // ── Submit: ONE atomic creation request ─────────────────────────────────
  await act(async () => {
    fireEvent.click(getEl("btn-step-5-submit"));
  });
  await flushUntil(
    "the wizard to close after creation",
    () => document.getElementById("onboarding-wizard-modal") === null,
  );

  // The flow completes: closed, draft cleared.
  expect(document.getElementById("onboarding-wizard-modal")).toBeNull();
  expect(window.localStorage.getItem("xf_wizard_draft_v1")).toBeNull();

  return { fixture, transport, descriptors };
}

// ---------------------------------------------------------------------------
// The three journeys
// ---------------------------------------------------------------------------

/**
 * The two journey tests, declared per fixture. The suite body is written ONCE
 * and the three suites below are declared at the top level (bun requires
 * `describe` at the top level); nothing in here branches on a provider.
 */
function journeyTests(fixture: JourneyFixture): void {
  afterEach(async () => {
    cleanup();
    clearWizardDraft();
    restoreApi();
    if (server) {
      await server.shutdown();
    }
  });

  it(`JOURNEY (${fixture.id}): the wizard creates the project, and the server persists what the journey is for`, async () => {
    server = startServer(0, undefined, undefined, journeyRegistry(fixture));
    baseUrl = `http://localhost:${server.port}`;

    const { transport, descriptors } = await runJourney(fixture);

    // ── Post-creation surfacing: the PERSISTED project, as served ────────
    const project = (await api.getProject(fixture.project.id)) as unknown as {
      id: string;
      name: string;
      workspacePath: string;
      gitIdentity: { name: string; email: string };
      connections: Array<{
        providerId: string;
        roles: string[];
        config: Record<string, unknown>;
      }>;
      repositories: Array<{
        id: string;
        name: string;
        defaultBranch: string;
        role?: string;
      }>;
    };

    expect(project.id).toBe(fixture.project.id);
    expect(project.name).toBe(fixture.project.name);
    expect(project.workspacePath).toBe(workspacePath);
    // The identity the executor's worktree resolves is the one the journey
    // read from the repository, recorded at project level (#131).
    expect(project.gitIdentity).toEqual(WORKSPACE_IDENTITY);

    // The connections: one per provider, with the roles it serves and the
    // NON-SECRET configuration it was configured with.
    expect(
      project.connections.map((connection) => ({
        providerId: connection.providerId,
        roles: [...connection.roles].sort(),
        config: connection.config,
      })),
    ).toEqual(
      fixture.expectedConnections.map((expected) => ({
        providerId: expected.providerId,
        roles: [...expected.roles].sort(),
        config: expected.config,
      })),
    );

    // The selected repository is persisted, role-tagged, primary.
    const repository = project.repositories.find(
      (repo) => repo.id === fixture.selectedRepositoryId,
    );
    expect(repository).toBeDefined();
    expect(repository?.name).toBe(fixture.selectedRepositoryId);
    expect(repository?.role).toBeDefined();

    // ── The combination reaches the post-creation surface unchanged ──────
    const integrity = deriveConnectionIntegrity(project as never, descriptors);
    expect(integrity.hasIntegrityFailure).toBe(false);
    const { container } = render(
      <ConnectionComboLine
        slots={comboSlots(integrity)}
        tone={comboTone(comboSlots(integrity), REQUIRED_CONNECTION_ROLES)}
        descriptors={descriptors}
      />,
    );
    for (const expected of fixture.expectedConnections) {
      const descriptor = descriptors.find((d) => d.id === expected.providerId);
      expect(descriptor).toBeDefined();
      expect(container.textContent).toContain(descriptor?.displayName ?? "");
    }
    expect(container.textContent).not.toContain(CONNECTIONS_COPY.notRecorded);
    cleanup();

    assertSecretsStayedOnTheirRoutes(transport, fixture);
  });

  it(`JOURNEY (${fixture.id}): the capability boundary is real — an unconfirmed capability is never a fabricated success`, async () => {
    server = startServer(0, undefined, undefined, journeyRegistry(fixture));
    baseUrl = `http://localhost:${server.port}`;
    // The manifest this test asserts against comes from the same real server.
    installRealApiClient();

    if (fixture.refusal === null) {
      // Every role this journey uses is served by a provider that declares
      // it, and the capabilities the manifest reports are the module's own.
      const descriptors = await api.providers.getManifest();
      for (const { module: provider, repositories } of fixture.providers) {
        const descriptor = descriptors.find((d) => d.id === provider.id);
        expect([...(descriptor?.roles ?? [])].sort()).toEqual(
          [...provider.roles].sort(),
        );
        expect(
          descriptor?.capabilities.includes("listRepositories") ?? false,
        ).toBe(repositories !== undefined);
      }
      return;
    }

    const { providerId, role, config } = fixture.refusal;

    // The refused provider does not declare the role at all, and the SERVER
    // refuses it with codes only — which is exactly why this journey's git
    // host is a different provider rather than a fabricated success.
    const res = await fetch(`${baseUrl}/api/providers/repositories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId, role, config }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      formErrors: ["INCOMPATIBLE_CONFIGURATION"],
    });

    // The provider's own manifest entry confirms it: no git-host role, and
    // no repository-discovery capability to confirm.
    const descriptors = await api.providers.getManifest();
    const refused = descriptors.find((d) => d.id === providerId);
    expect(refused?.roles).not.toContain(role);
    expect(refused?.capabilities).not.toContain("listRepositories");
  });
}

// The provider under test is DATA: three fixtures, three identical suites.
describe(`Provider journey — ${GITHUB_ONLY_JOURNEY.title} (#148)`, () => {
  journeyTests(GITHUB_ONLY_JOURNEY);
});

describe(`Provider journey — ${AZURE_DUAL_ROLE_JOURNEY.title} (#148)`, () => {
  journeyTests(AZURE_DUAL_ROLE_JOURNEY);
});

describe(`Provider journey — ${JIRA_TRACKER_ONLY_JOURNEY.title} (#148)`, () => {
  journeyTests(JIRA_TRACKER_ONLY_JOURNEY);
});

/** The credential surface: never in a response, only on the routes that must. */
function assertSecretsStayedOnTheirRoutes(
  transport: TransportLog,
  fixture: JourneyFixture,
): void {
  const secrets = journeySecrets(fixture);
  expect(secrets.length).toBeGreaterThan(0);
  for (const secret of secrets) {
    for (const body of transport.received) {
      expect(body).not.toContain(secret);
    }
    expect(document.body.textContent).not.toContain(secret);
    expect(
      window.localStorage.getItem("xf_wizard_draft_v1") ?? "",
    ).not.toContain(secret);
    // The credential is consumed by exactly three routes: the credential
    // check, the provider call that discovers with it, and the one creation
    // request that persists it. No read route ever sees it.
    const carryingRoutes = [
      ...new Set(
        transport.sent
          .filter((request) => request.body.includes(secret))
          .map((request) => request.path),
      ),
    ].sort();
    for (const route of carryingRoutes) {
      expect([
        "/api/projects",
        "/api/providers/repositories",
        "/api/providers/verify",
      ]).toContain(route);
    }
    expect(carryingRoutes).toContain("/api/providers/verify");
    expect(carryingRoutes).toContain("/api/projects");
    // The secret rode the creation request exactly once.
    expect(
      transport.sent.filter(
        (request) =>
          request.path === "/api/projects" && request.body.includes(secret),
      ).length,
    ).toBe(1);
  }
}
