// test/project-migration.test.ts — The migration write is validated, atomic and
// ordered (#163 B1): an existing successor id is a 409, an unknown provider or
// an invalid config is a 400 with a code, and a secret-write failure can never
// leave the predecessor archived without a successor.
//
// Everything runs against a temp config file and a temp data dir, so the repo's
// own config/projects.json is never touched.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { ApiContext } from "../src/composition-root.js";
import { handleApi } from "../src/http/routes.js";
import { loadProjectEnv } from "../src/project-env.js";
import {
  FILE_PROJECT_WRITE_STORE,
  type ProjectWriteStore,
} from "../src/services/connection-write-plan.js";
import { createTestRepositories } from "./helpers/composition.js";

let dataDir: string;
let configPath: string;
let repos: ApiContext["repos"];
let previousDataDir: string | undefined;
let previousConfigPath: string | undefined;

const PREDECESSOR = {
  id: "legacy-app",
  name: "Legacy App",
  repositoryPath: "/tmp/legacy-app",
  defaultBranch: "main",
  testCommand: "bun test",
  issueTracker: {
    provider: "jira",
    connectionId: "jira",
    jira: { host: "https://rocket.atlassian.net", email: "dev@example.com" },
  },
};

const OTHER = {
  id: "other-app",
  name: "Other App",
  repositoryPath: "/tmp/other-app",
  defaultBranch: "main",
  testCommand: "bun test",
  issueTracker: { provider: "github", connectionId: "github" },
};

async function seedConfig(): Promise<void> {
  await writeFile(
    configPath,
    `${JSON.stringify({ projects: [PREDECESSOR, OTHER] }, null, 2)}\n`,
    "utf-8",
  );
}

async function storedProjects(): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(configPath, "utf-8");
  return (JSON.parse(raw) as { projects: Array<Record<string, unknown>> })
    .projects;
}

function migrate(
  projectId: string,
  body: unknown,
  extra: Partial<ApiContext> = {},
): Promise<Response> {
  const req = new Request(
    `http://localhost:3777/api/projects/${projectId}/migrate`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  return handleApi(req, new URL(req.url), { repos, ...extra });
}

beforeEach(async () => {
  previousDataDir = process.env.X_FACTORY_DATA_DIR;
  previousConfigPath = process.env.X_FACTORY_CONFIG_PATH;
  dataDir = await mkdtemp(path.join(tmpdir(), "xf-migrate-"));
  process.env.X_FACTORY_DATA_DIR = dataDir;
  configPath = path.join(dataDir, "projects.json");
  process.env.X_FACTORY_CONFIG_PATH = configPath;
  await seedConfig();
  repos = createTestRepositories();
});

describe("POST /api/projects/:id/migrate (#163 B1)", () => {
  test("rejects the project's own id with 409 and leaves the project live", async () => {
    const res = await migrate("legacy-app", {
      targetProvider: "github",
      newProjectId: "legacy-app",
      github: { repo: "my-org/my-repo" },
      secrets: { token: "ghp_migrate_secret" },
    });

    expect(res.status).toBe(409);
    const projects = await storedProjects();
    const predecessor = projects.find((p) => p.id === "legacy-app");
    expect(predecessor?.archived).toBeFalsy();
    expect(projects.length).toBe(2);
  });

  test("rejects an id another project already holds with 409", async () => {
    const res = await migrate("legacy-app", {
      targetProvider: "github",
      newProjectId: "other-app",
      github: { repo: "my-org/my-repo" },
      secrets: { token: "ghp_migrate_secret" },
    });

    expect(res.status).toBe(409);
    const projects = await storedProjects();
    const other = projects.find((p) => p.id === "other-app");
    expect(other?.name).toBe("Other App");
    expect(projects.length).toBe(2);
  });

  test("an unknown target provider is a 400 with a machine-readable code", async () => {
    const res = await migrate("legacy-app", {
      targetProvider: "not-a-real-provider",
      github: { repo: "my-org/my-repo" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "UNKNOWN_PROVIDER" });
    const projects = await storedProjects();
    expect(projects.length).toBe(2);
    expect(projects.find((p) => p.id === "legacy-app")?.archived).toBeFalsy();
  });

  test("an invalid provider config is a 400 with a code and writes nothing", async () => {
    const res = await migrate("legacy-app", {
      targetProvider: "github",
      newProjectId: "legacy-app-gh",
      github: { repository: 5 },
      secrets: { token: "ghp_migrate_secret" },
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: "INVALID_CONFIG" });
    const projects = await storedProjects();
    expect(projects.length).toBe(2);
    expect(projects.find((p) => p.id === "legacy-app")?.archived).toBeFalsy();
    expect(projects.some((p) => p.id === "legacy-app-gh")).toBe(false);
  });

  test("a secret-write failure leaves the predecessor unarchived and writes no successor", async () => {
    const failingStore: ProjectWriteStore = {
      ...FILE_PROJECT_WRITE_STORE,
      async saveProjectEnv(): Promise<void> {
        throw new Error("secret store unavailable");
      },
    };

    const res = await migrate(
      "legacy-app",
      {
        targetProvider: "github",
        newProjectId: "legacy-app-gh",
        github: { repo: "my-org/my-repo" },
        secrets: { token: "ghp_migrate_secret" },
      },
      { projectWriteStore: failingStore },
    );

    expect(res.status).toBe(500);
    const projects = await storedProjects();
    expect(projects.length).toBe(2);
    const predecessor = projects.find((p) => p.id === "legacy-app");
    expect(predecessor?.archived).toBeFalsy();
    expect(predecessor?.successorId).toBeUndefined();
    expect(projects.some((p) => p.id === "legacy-app-gh")).toBe(false);
  });
  test("archives the predecessor and creates the successor with the secret routed to env", async () => {
    const res = await migrate("legacy-app", {
      targetProvider: "github",
      newProjectId: "legacy-app-gh",
      name: "Legacy App GitHub",
      github: { repo: "my-org/my-repo" },
      secrets: { token: "ghp_migrate_secret" },
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      predecessorId: string;
      newProjectId: string;
      project: { id: string };
    };
    expect(body.predecessorId).toBe("legacy-app");
    expect(body.newProjectId).toBe("legacy-app-gh");
    expect(body.project.id).toBe("legacy-app-gh");

    const projects = await storedProjects();
    const predecessor = projects.find((p) => p.id === "legacy-app");
    expect(predecessor?.archived).toBe(true);
    expect(predecessor?.successorId).toBe("legacy-app-gh");

    const successor = projects.find((p) => p.id === "legacy-app-gh");
    expect(successor?.predecessorId).toBe("legacy-app");
    expect(successor?.archived).toBe(false);
    // The credential never lands on the record.
    expect(JSON.stringify(successor)).not.toContain("ghp_migrate_secret");

    const env = await loadProjectEnv("legacy-app-gh");
    expect(env.GITHUB_TOKEN).toBe("ghp_migrate_secret");
  });

  test("a connection-set successor keeps the surviving git host and routes the new tracker secret", async () => {
    const id = "conn-migrate";
    const created = await handleApi(
      new Request("http://localhost:3777/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: "Connections App",
          workspacePath: dataDir,
          connections: [
            {
              providerId: "jira",
              roles: ["tracker"],
              config: {
                host: "https://rocket.atlassian.net",
                email: "dev@example.com",
                apiToken: "jira-token-migrate",
                project: "ROCKET",
              },
            },
            {
              providerId: "github",
              roles: ["gitHost"],
              config: {
                repoOwner: "acme",
                repository: "web",
                token: "ghp-git-host-migrate",
              },
            },
          ],
          repositories: [
            {
              id: `${id}-web`,
              name: "web",
              remote: "https://github.com/acme/web.git",
              defaultBranch: "main",
              localPath: path.join(dataDir, "web"),
              role: "frontend",
              primary: true,
            },
          ],
        }),
      }),
      new URL("http://localhost:3777/api/projects"),
      { repos },
    );
    expect(created.status).toBe(201);

    const res = await migrate(id, {
      targetProvider: "azure",
      azure: { orgUrl: "https://dev.azure.com/acme", project: "Rocket" },
      secrets: { pat: "azure-pat-migrate" },
    });
    expect(res.status).toBe(201);

    const projects = await storedProjects();
    const successor = projects.find((p) => p.id === `${id}-azure`);
    expect(successor).toBeDefined();
    const connections = successor?.connections as Array<{
      providerId: string;
      roles: string[];
    }>;
    expect(connections.map((c) => c.providerId)).toEqual(["azure", "github"]);
    expect(connections.find((c) => c.providerId === "github")?.roles).toEqual([
      "gitHost",
    ]);

    const env = await loadProjectEnv(`${id}-azure`);
    expect(env.AZURE_DEVOPS_PAT).toBe("azure-pat-migrate");
  });
});

afterEach(async () => {
  if (previousDataDir === undefined) delete process.env.X_FACTORY_DATA_DIR;
  else process.env.X_FACTORY_DATA_DIR = previousDataDir;
  if (previousConfigPath === undefined)
    delete process.env.X_FACTORY_CONFIG_PATH;
  else process.env.X_FACTORY_CONFIG_PATH = previousConfigPath;
  await rm(dataDir, { recursive: true, force: true });
});
