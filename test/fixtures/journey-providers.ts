// test/fixtures/journey-providers.ts — the three onboarding journeys as DATA
// (spec #133, ticket #148).
//
// A journey is a fixture, not a code path: which providers are registered, the
// URL a user pastes, what each provider answers, what the user types, and what
// the created project must record. The journey tests iterate these fixtures and
// contain no provider conditional at all, so a fourth provider is a fourth
// entry here rather than a fourth branch in the test.
//
// The provider modules are the REAL ones (`src/providers/*-module.ts`): the URL
// shapes the user pastes, the configuration descriptors the cards render from,
// the roles each provider declares, and its capability set all come from the
// provider that owns them. Only the two network boundaries — credential
// verification and repository discovery — stand in, through the registry
// injection point the provider contract opened for exactly this purpose
// (`startServer(port, dir, db, registry)`), so `POST /api/providers/parse-url`,
// `/verify`, `/repositories` and `POST /api/projects` all execute real server
// code against these providers.

import { azureProvider } from "../../src/providers/azure-module.js";
import type {
  Provider,
  ProviderRepository,
  VerificationResult,
} from "../../src/providers/contract.js";
import { githubProvider } from "../../src/providers/github-module.js";
import { jiraProvider } from "../../src/providers/jira-module.js";

/** One role a connection can serve. */
export type JourneyRole = "tracker" | "gitHost";

/** One provider as the journey registers it. */
export interface JourneyProvider {
  /** The real provider module: url shapes, roles, config descriptors. */
  readonly module: Provider;
  /** What the injected registry answers when the credentials are verified. */
  readonly verification: VerificationResult;
  /** What the injected registry answers when repositories are listed. */
  readonly repositories?: readonly ProviderRepository[] | undefined;
}

/** A configuration value the user types into one card. */
export interface JourneyTypedField {
  readonly role: JourneyRole;
  readonly field: string;
  readonly value: string;
  /** True for a credential: never in a response, never in the draft. */
  readonly secret: boolean;
}

/** One connection the created project must record. */
export interface JourneyExpectedConnection {
  readonly providerId: string;
  readonly roles: readonly JourneyRole[];
  /** The NON-SECRET configuration, exactly as it must be persisted. */
  readonly config: Record<string, unknown>;
}

/** A provider that cannot serve a role at all — the honest capability boundary. */
export interface JourneyRefusal {
  readonly providerId: string;
  readonly role: JourneyRole;
  readonly config: Record<string, unknown>;
}

export interface JourneyFixture {
  readonly id: string;
  readonly title: string;
  readonly project: { readonly name: string; readonly id: string };
  /** The URL the user pastes into Quick-URL intake. */
  readonly quickUrl: string;
  /** Roles the paste fills on its own (the provider serves them). */
  readonly filledRoles: readonly JourneyRole[];
  /** The provider the user selects for each role, whatever filled it. */
  readonly roleProvider: Record<JourneyRole, string>;
  /** Everything the user types by hand, on top of the paste. */
  readonly typed: readonly JourneyTypedField[];
  /** The repository the user selects from the git host's discovery. */
  readonly selectedRepositoryId: string;
  /**
   * Degraded verification evidence for a role (the capability that could not be
   * confirmed), or null. A degraded role must be explicitly accepted before the
   * flow continues — never a fabricated success.
   */
  readonly degraded: {
    readonly role: JourneyRole;
    readonly capability: string;
  } | null;
  /** A capability boundary the journey proves through the real route. */
  readonly refusal: JourneyRefusal | null;
  readonly expectedConnections: readonly JourneyExpectedConnection[];
  readonly providers: readonly JourneyProvider[];
}

/** The registry backing a journey: real modules, standing in for the network. */
export function journeyRegistry(
  fixture: JourneyFixture,
): ReadonlyMap<string, Provider> {
  return new Map(
    fixture.providers.map(({ module, verification, repositories }) => [
      module.id,
      {
        // The real module first: url shapes, roles, config descriptors and
        // capabilities stay exactly as shipped.
        ...module,
        verifyCredentials: async () => verification,
        ...(repositories === undefined
          ? {}
          : { listRepositories: async () => [...repositories] }),
      } satisfies Provider,
    ]),
  );
}

/** The secret values the journey types — asserted absent from every response. */
export function journeySecrets(fixture: JourneyFixture): string[] {
  return [
    ...new Set(
      fixture.typed.filter((field) => field.secret).map((field) => field.value),
    ),
  ];
}

const GITHUB_TOKEN = "ghp_synthetic_148_token";
const JIRA_TOKEN = "atl_synthetic_148_token";
const AZURE_PAT = "az_synthetic_148_pat";

const GITHUB_REPOSITORIES: readonly ProviderRepository[] = [
  {
    id: "rocket-app",
    name: "rocket-app",
    remote: "https://github.com/acme/rocket-app.git",
    defaultBranch: "main",
    webUrl: "https://github.com/acme/rocket-app",
  },
  {
    id: "rocket-infra",
    name: "rocket-infra",
    remote: "https://github.com/acme/rocket-infra.git",
    defaultBranch: "main",
  },
];

const AZURE_REPOSITORIES: readonly ProviderRepository[] = [
  {
    id: "rocket-app",
    name: "rocket-app",
    remote: "https://dev.azure.com/acme/Rocket/_git/rocket-app",
    defaultBranch: "main",
  },
];

/**
 * GitHub-only: one paste fills BOTH cards (GitHub declares both roles), and the
 * project is created with ONE dual-role connection.
 */
export const GITHUB_ONLY_JOURNEY: JourneyFixture = {
  id: "github-only",
  title:
    "GitHub-only: one paste fills both cards into one dual-role connection",
  project: { name: "Rocket App", id: "rocket-app" },
  quickUrl: "https://github.com/acme/rocket-app",
  filledRoles: ["tracker", "gitHost"],
  roleProvider: { tracker: "github", gitHost: "github" },
  // `token` is required for each role's configuration, so the credential is
  // typed on the card that is being verified — the shipped per-card model
  // (#143); the payload then records ONE connection for the provider.
  typed: [
    { role: "tracker", field: "token", value: GITHUB_TOKEN, secret: true },
    { role: "gitHost", field: "token", value: GITHUB_TOKEN, secret: true },
  ],
  selectedRepositoryId: "rocket-app",
  degraded: null,
  refusal: null,
  expectedConnections: [
    {
      providerId: "github",
      roles: ["tracker", "gitHost"],
      config: { repoOwner: "acme", repository: "rocket-app" },
    },
  ],
  providers: [
    {
      module: githubProvider,
      verification: { status: "ok", warnings: [] },
      repositories: GITHUB_REPOSITORIES,
    },
  ],
};

/**
 * Azure dual-role: the paste fills both cards from one `dev.azure.com` URL, the
 * PAT is entered ONCE (the schema declares it optional, and one connection
 * carries both roles), and the project is created with one dual-role
 * connection.
 */
export const AZURE_DUAL_ROLE_JOURNEY: JourneyFixture = {
  id: "azure-dual-role",
  title: "Azure dual-role: one paste, one PAT, one connection serving both",
  project: { name: "Rocket Platform", id: "rocket-platform" },
  quickUrl: "https://dev.azure.com/acme/Rocket",
  filledRoles: ["tracker", "gitHost"],
  roleProvider: { tracker: "azure", gitHost: "azure" },
  typed: [{ role: "gitHost", field: "pat", value: AZURE_PAT, secret: true }],
  selectedRepositoryId: "rocket-app",
  degraded: null,
  refusal: null,
  expectedConnections: [
    {
      providerId: "azure",
      roles: ["tracker", "gitHost"],
      config: { orgUrl: "https://dev.azure.com/acme", project: "Rocket" },
    },
  ],
  providers: [
    {
      module: azureProvider,
      verification: { status: "ok", warnings: [] },
      repositories: AZURE_REPOSITORIES,
    },
  ],
};

/**
 * Jira tracker-only: Jira serves the tracker role and NOTHING else. The paste
 * fills only the tracker card; the git host is a different provider. Jira's
 * verification is DEGRADED — the ticket capability could not be confirmed — and
 * the journey honours that evidence by accepting it explicitly, never by
 * treating it as a success. `refusal` proves through the real route that Jira
 * cannot be a git host at all.
 */
export const JIRA_TRACKER_ONLY_JOURNEY: JourneyFixture = {
  id: "jira-tracker-only",
  title:
    "Jira tracker-only: degraded tracker evidence, git host from another provider",
  project: { name: "Rocket Support", id: "rocket-support" },
  quickUrl: "https://acme.atlassian.net/browse/ROCK-42",
  filledRoles: ["tracker"],
  roleProvider: { tracker: "jira", gitHost: "github" },
  typed: [
    {
      role: "tracker",
      field: "email",
      value: "owner@example.com",
      secret: false,
    },
    { role: "tracker", field: "apiToken", value: JIRA_TOKEN, secret: true },
    { role: "gitHost", field: "repoOwner", value: "acme", secret: false },
    { role: "gitHost", field: "token", value: GITHUB_TOKEN, secret: true },
  ],
  selectedRepositoryId: "rocket-infra",
  degraded: { role: "tracker", capability: "listTickets" },
  refusal: {
    providerId: "jira",
    role: "gitHost",
    config: { host: "https://acme.atlassian.net", project: "ROCK" },
  },
  expectedConnections: [
    {
      providerId: "jira",
      roles: ["tracker"],
      config: {
        host: "https://acme.atlassian.net",
        project: "ROCK",
        // The email the user typed on the card: non-secret, so it persists.
        email: "owner@example.com",
      },
    },
    {
      providerId: "github",
      roles: ["gitHost"],
      config: { repoOwner: "acme" },
    },
  ],
  providers: [
    {
      module: jiraProvider,
      verification: {
        status: "degraded",
        warnings: [
          { kind: "CAPABILITY_UNCONFIRMED", capability: "listTickets" },
        ],
      },
    },
    {
      module: githubProvider,
      verification: { status: "ok", warnings: [] },
      repositories: GITHUB_REPOSITORIES,
    },
  ],
};

/** The three provider journeys, in the order they are exercised. */
export const PROVIDER_JOURNEYS: readonly JourneyFixture[] = [
  GITHUB_ONLY_JOURNEY,
  AZURE_DUAL_ROLE_JOURNEY,
  JIRA_TRACKER_ONLY_JOURNEY,
];
