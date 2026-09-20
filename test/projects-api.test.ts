// test/projects-api.test.ts — Integration tests for project management and onboarding APIs.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execStrict } from "../src/proc.js";
import { startServer } from "../src/server.js";

let server: ReturnType<typeof startServer>;
let baseUrl: string;
let tempDir: string;
let originalProjectsJson: string | null = null;
const projectsJsonPath = path.resolve(
  __dirname,
  "..",
  "config",
  "projects.json",
);

beforeAll(async () => {
  try {
    originalProjectsJson = await readFile(projectsJsonPath, "utf-8");
  } catch {
    // ignore
  }
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-proj-api-test-"));
  // Run on an ephemeral port
  server = startServer(0);
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(async () => {
  server.stop(true);
  if (tempDir) {
    await rm(tempDir, { recursive: true, force: true });
  }
  if (originalProjectsJson !== null) {
    await writeFile(projectsJsonPath, originalProjectsJson, "utf-8");
  }
});

describe("Project Onboarding & Management APIs", () => {
  const testProjectId = `proj-${Date.now()}`;

  it("POST /api/projects creates a new multi-repository project", async () => {
    const payload = {
      id: testProjectId,
      name: "Test Product",
      workspacePath: tempDir,
      issueTracker: {
        connectionId: "azure",
        projectId: "test-az-project",
      },
      repositories: [
        {
          id: `${testProjectId}-web`,
          name: "web",
          path: path.join(tempDir, "web"),
          defaultBranch: "main",
          role: "frontend",
          commands: {
            test: "bun test",
          },
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      id: string;
      name: string;
      repositories: unknown[];
    };
    assert.equal(body.id, testProjectId);
    assert.equal(body.name, "Test Product");
    assert.equal(body.repositories.length, 1);
  });

  it("GET /api/projects/:id returns project and readiness", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${testProjectId}`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      id: string;
      readiness: { ready: boolean; totalCount: number };
    };
    assert.equal(body.id, testProjectId);
    assert.ok(body.readiness !== undefined);
    assert.equal(body.readiness.totalCount, 1);
  });

  it("PATCH /api/projects/:id updates existing project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${testProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Updated Product Name" }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { name: string };
    assert.equal(body.name, "Updated Product Name");
  });

  it("POST /api/projects/inspect-repository inspects a directory", async () => {
    const repoDir = path.join(tempDir, "sample-repo");
    await execStrict("git", ["init", repoDir]);
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], { cwd: repoDir });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { exists: boolean; isGitRepo: boolean };
    assert.equal(body.exists, true);
    assert.equal(body.isGitRepo, true);
  });

  it("POST /api/projects/discover-repositories rejects unsupported provider", async () => {
    const res = await fetch(`${baseUrl}/api/projects/discover-repositories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "nonexistent" }),
    });

    assert.equal(res.status, 400);
    const err = (await res.json()) as { error: string };
    assert.ok(err.error.includes("Unsupported discovery provider"));
  });

  it("POST /api/projects/discover-repositories discovers with local provider", async () => {
    const res = await fetch(`${baseUrl}/api/projects/discover-repositories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "local", workspacePath: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      repositories: Array<{ name: string }>;
    };
    assert.ok(Array.isArray(body.repositories));
    assert.ok(body.repositories.some((r) => r.name === "sample-repo"));
  });

  it("DELETE /api/projects/:id removes project", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${testProjectId}`, {
      method: "DELETE",
    });

    assert.equal(res.status, 200);

    const check = await fetch(`${baseUrl}/api/projects/${testProjectId}`);
    assert.equal(check.status, 404);
  });

  it("POST /api/projects/check-path verifies local directory and git repos", async () => {
    const res = await fetch(`${baseUrl}/api/projects/check-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { exists: boolean; gitRepos: string[] };
    assert.equal(body.exists, true);
    assert.ok(Array.isArray(body.gitRepos));
  });

  it("POST /api/projects/test-connection validates connection parameters", async () => {
    const res = await fetch(`${baseUrl}/api/projects/test-connection`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "azure", project: "nonexistent" }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, false);
  });

  it("POST /api/projects/validate-path routes to path checking and returns existsLocally", async () => {
    const res = await fetch(`${baseUrl}/api/projects/validate-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      existsLocally: boolean;
      resolvedPath: string;
    };
    assert.equal(body.exists, true);
    assert.equal(body.existsLocally, true);
    assert.ok(body.resolvedPath.length > 0);
  });

  it("POST /api/projects/test-tracker routes to connection test", async () => {
    const res = await fetch(`${baseUrl}/api/projects/test-tracker`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "azure", project: "nonexistent" }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, false);
  });

  it("POST /api/projects/discover routes to repository discovery", async () => {
    const res = await fetch(`${baseUrl}/api/projects/discover`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "local", workspacePath: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      repositories: Array<{ name: string }>;
    };
    assert.ok(Array.isArray(body.repositories));
  });

  it("POST /api/projects/inspect-repository includes readiness status", async () => {
    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      readiness: { status: string; message: string };
    };
    assert.equal(body.exists, true);
    assert.ok(
      ["ready", "pending_setup", "error"].includes(body.readiness.status),
    );
  });

  it("POST /api/discovery/validate-path routes through discovery namespace", async () => {
    const res = await fetch(`${baseUrl}/api/discovery/validate-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as { exists: boolean };
    assert.equal(body.exists, true);
  });

  const trackerProjId = `proj-tracker-${Date.now()}`;

  it("sets up a fresh project for tracker & migration tests", async () => {
    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: trackerProjId,
        name: "Tracker Test Product",
        workspacePath: tempDir,
        issueTracker: {
          provider: "azure",
          connectionId: "azure",
          azure: {
            orgUrl: "https://dev.azure.com/testorg",
            project: "TestProject",
          },
        },
        repositories: [
          {
            id: `${trackerProjId}-repo`,
            name: "repo",
            path: path.join(tempDir, "repo"),
            defaultBranch: "main",
            role: "frontend",
          },
        ],
      }),
    });
    assert.equal(res.status, 201);
  });

  it("GET /api/projects/:id/tracker returns tracker config and secret status", async () => {
    const res = await fetch(`${baseUrl}/api/projects/${trackerProjId}/tracker`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      provider: string;
      hasSecret: boolean;
      secretMask: string;
      secretKey: string;
    };
    assert.equal(body.provider, "azure");
    assert.equal(typeof body.hasSecret, "boolean");
    assert.equal(body.secretKey, "AZURE_DEVOPS_PAT");
  });

  it("PUT /api/projects/:id/tracker/credentials updates credentials in per-project .env", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tracker/credentials`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: "test-azure-pat-9999" }),
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; message: string };
    assert.equal(body.ok, true);

    // Verify GET /tracker now shows hasSecret = true
    const checkRes = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tracker`,
    );
    const checkBody = (await checkRes.json()) as {
      hasSecret: boolean;
      secretMask: string;
    };
    assert.equal(checkBody.hasSecret, true);
    assert.ok(checkBody.secretMask.includes("9999"));
  });

  it("POST /api/projects/:id/tracker/test tests tracker connection", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tracker/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(typeof body.ok, "boolean");
  }, 15000);

  it("POST /api/projects/:id/migrate blocks migration with 409 if project has active run", async () => {
    const { getRunRepository } = await import("../src/runs.js");
    const activeRunId = `run-active-${Date.now()}`;
    const runRepo = getRunRepository();
    runRepo.create({
      id: activeRunId,
      projectId: trackerProjId,
      projectName: "Tracker Test Product",
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "test",
      branch: "test",
      status: "implementing",
      artifactsDir: tempDir,
      worktreePath: tempDir,
    });

    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/migrate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProvider: "github",
          github: { repo: "org/repo" },
        }),
      },
    );
    assert.equal(res.status, 409);
    const errBody = (await res.json()) as { error: string };
    assert.ok(errBody.error.includes("active runs"));

    // Finish the run
    runRepo.update(activeRunId, { status: "stopped" });
  });

  it("POST /api/projects/:id/migrate archives predecessor and creates successor", async () => {
    const successorId = `${trackerProjId}-github`;
    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/migrate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetProvider: "github",
          newProjectId: successorId,
          name: "Test Product GitHub",
          github: { repo: "my-org/my-repo" },
          secrets: { token: "ghp_migration_secret_token" },
        }),
      },
    );
    assert.equal(res.status, 201);
    const body = (await res.json()) as {
      ok: boolean;
      predecessorId: string;
      newProjectId: string;
      project: { id: string; archived: boolean; predecessorId?: string };
    };
    assert.equal(body.ok, true);
    assert.equal(body.predecessorId, trackerProjId);
    assert.equal(body.newProjectId, successorId);
    assert.equal(body.project.id, successorId);
    assert.equal(body.project.predecessorId, trackerProjId);
    assert.equal(body.project.archived, false);

    // Verify predecessor is archived
    const predRes = await fetch(`${baseUrl}/api/projects/${trackerProjId}`);
    assert.equal(predRes.status, 200);
    const predBody = (await predRes.json()) as {
      archived: boolean;
      successorId: string;
    };
    assert.equal(predBody.archived, true);
    assert.equal(predBody.successorId, successorId);

    // Verify GET /tickets returns 400 for archived project
    const ticketRes = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tickets`,
    );
    assert.equal(ticketRes.status, 400);

    // Verify GET /api/projects excludes archived project by default
    const listRes = await fetch(`${baseUrl}/api/projects`);
    const list = (await listRes.json()) as Array<{ id: string }>;
    assert.ok(!list.some((p) => p.id === trackerProjId));
    assert.ok(list.some((p) => p.id === successorId));

    // Verify GET /api/projects?includeArchived=true includes both
    const allRes = await fetch(`${baseUrl}/api/projects?includeArchived=true`);
    const allList = (await allRes.json()) as Array<{ id: string }>;
    assert.ok(allList.some((p) => p.id === trackerProjId));
    assert.ok(allList.some((p) => p.id === successorId));
  });

  it("tests GitHub tracker endpoints on successor project", async () => {
    const successorId = `${trackerProjId}-github`;
    const trackerRes = await fetch(
      `${baseUrl}/api/projects/${successorId}/tracker`,
    );
    assert.equal(trackerRes.status, 200);
    const trackerBody = (await trackerRes.json()) as {
      provider: string;
      hasSecret: boolean;
    };
    assert.equal(trackerBody.provider, "github");
    assert.equal(trackerBody.hasSecret, true);

    const updateRes = await fetch(
      `${baseUrl}/api/projects/${successorId}/tracker/credentials`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "ghp_updated_token" }),
      },
    );
    assert.equal(updateRes.status, 200);

    const testRes = await fetch(
      `${baseUrl}/api/projects/${successorId}/tracker/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repo: "my-org/my-repo" }),
      },
    );
    assert.equal(testRes.status, 200);
  }, 15000);

  it("tests Jira tracker endpoints", async () => {
    const jiraProjId = `proj-jira-${Date.now()}`;
    const createRes = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: jiraProjId,
        name: "Jira Product",
        workspacePath: tempDir,
        issueTracker: {
          provider: "jira",
          jira: {
            host: "https://example.atlassian.net",
            email: "dev@example.com",
            project: "JIRA",
          },
        },
        repositories: [
          {
            id: `${jiraProjId}-repo`,
            name: "repo",
            path: path.join(tempDir, "repo"),
            defaultBranch: "main",
            role: "backend",
          },
        ],
      }),
    });
    assert.equal(createRes.status, 201);

    const trackerRes = await fetch(
      `${baseUrl}/api/projects/${jiraProjId}/tracker`,
    );
    assert.equal(trackerRes.status, 200);
    const trackerBody = (await trackerRes.json()) as { provider: string };
    assert.equal(trackerBody.provider, "jira");

    const updateRes = await fetch(
      `${baseUrl}/api/projects/${jiraProjId}/tracker/credentials`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: "jira_token_xyz" }),
      },
    );
    assert.equal(updateRes.status, 200);

    const testRes = await fetch(
      `${baseUrl}/api/projects/${jiraProjId}/tracker/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    );
    assert.equal(testRes.status, 200);
  }, 15000);
});
