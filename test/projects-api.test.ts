// test/projects-api.test.ts — Integration tests for project management and onboarding APIs.

import { describe, it, beforeAll, afterAll } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startServer } from "../src/server.js";
import { execStrict } from "../src/proc.js";

let server: ReturnType<typeof startServer>;
let baseUrl: string;
let tempDir: string;

beforeAll(async () => {
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
    const body = (await res.json()) as { id: string; name: string; repositories: unknown[] };
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
    await execStrict("git", ["config", "user.email", "dev@test.com"], { cwd: repoDir });
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
    const body = (await res.json()) as { repositories: Array<{ name: string }> };
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
});
