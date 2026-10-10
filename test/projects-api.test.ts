// test/projects-api.test.ts — Integration tests for project management and onboarding APIs.

import { afterAll, beforeAll, describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Repositories } from "../src/composition-root.js";
import { getProjectsConfigPath } from "../src/paths.js";
import { execStrict } from "../src/proc.js";
import { azureProvider } from "../src/providers/azure-module.js";
import type {
  Provider,
  ProviderConfig,
  ProviderErrorContext,
  ProviderErrorEnvelope,
  VerificationResult,
} from "../src/providers/contract.js";
import { githubProvider } from "../src/providers/github-module.js";
import { jiraProvider } from "../src/providers/jira-module.js";
import type { ProviderRegistry } from "../src/providers/registry.js";
import { startServer } from "../src/server.js";
import { createTestRepositories } from "./helpers/composition.js";
import { forceRunStatus } from "./helpers/run-status-fixture.js";

let server: ReturnType<typeof startServer>;
let repos: Repositories;
let baseUrl: string;
let tempDir: string;
let originalProjectsJson: string | null = null;
const projectsJsonPath = getProjectsConfigPath();

beforeAll(async () => {
  try {
    originalProjectsJson = await readFile(projectsJsonPath, "utf-8");
  } catch {
    // ignore
  }
  tempDir = await mkdtemp(path.join(tmpdir(), "xf-proj-api-test-"));
  // Run on an ephemeral port; the server and the seeding share one connection.
  repos = createTestRepositories();
  server = startServer(0, undefined, repos.db, testRegistry);
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

/**
 * Deterministic provider probes (#183). These tests must never touch the
 * network, so the three providers keep their REAL config schemas while their
 * network calls are recorded stubs. `verifyCredentials` succeeds by default;
 * `trackerVerifyFailure` turns the next probe into a normalized AUTH_INVALID
 * failure (401 at the boundary) so both outcomes are asserted exactly.
 */
const trackerVerifyCalls: ProviderConfig[] = [];
let trackerVerifyFailure: Error | null = null;

function withDeterministicProbe(provider: Provider): Provider {
  return {
    ...provider,
    async verifyCredentials(
      config: ProviderConfig,
    ): Promise<VerificationResult> {
      trackerVerifyCalls.push(config);
      if (trackerVerifyFailure !== null) throw trackerVerifyFailure;
      return { status: "ok", warnings: [] };
    },
    toUserError(
      _raw: unknown,
      context: ProviderErrorContext,
    ): ProviderErrorEnvelope {
      return { code: "AUTH_INVALID", context };
    },
  };
}

const testRegistry: ProviderRegistry = new Map<string, Provider>([
  [azureProvider.id, withDeterministicProbe(azureProvider)],
  [githubProvider.id, withDeterministicProbe(githubProvider)],
  [jiraProvider.id, withDeterministicProbe(jiraProvider)],
]);

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

  it("POST /api/projects rejects duplicate project creation with 409 Conflict", async () => {
    // The payload names a tracker: without one it is rejected before the write
    // it is here to duplicate, so it would never reach the conflict it tests.
    const payload = {
      id: testProjectId,
      name: "Duplicate Product",
      workspacePath: tempDir,
      issueTracker: { connectionId: "azure", projectId: "duplicate-project" },
      repositories: [
        {
          id: `${testProjectId}-web`,
          name: "web",
          path: path.join(tempDir, "web"),
          defaultBranch: "main",
          role: "frontend",
        },
      ],
    };

    const res = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(res.status, 409);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes("already exists"));

    // Verify existing project was not overwritten
    const checkRes = await fetch(`${baseUrl}/api/projects/${testProjectId}`);
    const checkBody = (await checkRes.json()) as { name: string };
    assert.equal(checkBody.name, "Test Product"); // Original name
  });

  it("POST /api/projects fails if configuration file is malformed", async () => {
    const currentProjects = await readFile(projectsJsonPath, "utf-8");
    try {
      await writeFile(projectsJsonPath, "malformed {", "utf-8");
      const res = await fetch(`${baseUrl}/api/projects`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "proj-malformed-test",
          name: "Malformed Product",
          workspacePath: tempDir,
          // A tracker is named so the request reaches the malformed config file
          // rather than being rejected for the missing tracker it no longer may
          // be created without.
          issueTracker: {
            connectionId: "azure",
            projectId: "malformed-project",
          },
          repositories: [
            {
              id: `proj-malformed-test-repo`,
              name: "repo",
              path: path.join(tempDir, "repo"),
              defaultBranch: "main",
              role: "frontend",
            },
          ],
        }),
      });
      assert.equal(res.status, 500);
      const body = (await res.json()) as { error: string; code?: string };
      // #163 B2: the parse failure's text can quote the malformed file, so the
      // client only ever sees the generic envelope. The detail is logged
      // server-side (test/http-error-translation.test.ts owns that assertion).
      assert.deepEqual(body, { error: "Internal error", code: "INTERNAL" });
    } finally {
      // Restore previous projects file for rest of tests
      await writeFile(projectsJsonPath, currentProjects, "utf-8");
    }
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
    await execStrict("git", ["init", repoDir], { envPolicy: "inherit" });
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });

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

  // Rewritten for #183: the flat provider aliases in the projects controller are
  // deleted. The coverage these tests pinned for the deleted routes is replaced
  // at this seam by asserting they are gone, and by the canonical providers
  // route still answering for the same request shape.
  it("POST /api/projects/discover-repositories is gone; the providers route is canonical (#183)", async () => {
    const flat = await fetch(`${baseUrl}/api/projects/discover-repositories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: "nonexistent" }),
    });
    assert.equal(flat.status, 404);
    assert.deepEqual(await flat.json(), { error: "Endpoint not found." });

    const canonical = await fetch(`${baseUrl}/api/providers/repositories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ providerId: "nonexistent", config: {} }),
    });
    assert.equal(canonical.status, 409);
    assert.deepEqual(await canonical.json(), {
      formErrors: ["UNKNOWN_PROVIDER"],
    });
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
    const body = (await res.json()) as {
      exists: boolean;
      existsLocally: boolean;
      resolvedPath: string;
      gitRepos: string[];
    };
    assert.equal(body.exists, true);
    // The retired validate-path alias asserted these two; the canonical
    // check-path route must keep carrying them (#192).
    assert.equal(body.existsLocally, true);
    assert.ok(body.resolvedPath.length > 0);
    assert.ok(Array.isArray(body.gitRepos));
  });

  // Rewritten for #183. The flat connection-test and scope-diagnostic aliases
  // are deleted: connection testing is `POST /api/providers/verify` (or the
  // project-scoped `POST /api/projects/{id}/tracker/test`), and scope
  // verification is `POST /api/projects/{id}/tracker/scopes` — both covered at
  // the HTTP API seam in test/provider-scope-diagnostics.test.ts and
  // test/project-connections-api.test.ts.
  it("the flat connection-test and scope-diagnostic aliases are gone (#183)", async () => {
    const aliases = [
      "test-connection",
      "test-tracker",
      "test-scopes",
      "test-azure-scopes",
    ];

    for (const alias of aliases) {
      const res = await fetch(`${baseUrl}/api/projects/${alias}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: "azure", project: "nonexistent" }),
      });

      assert.equal(res.status, 404);
      assert.deepEqual(await res.json(), { error: "Endpoint not found." });
    }
  });

  it("the removed validate-path alias answers 404 (canonical route is check-path, #192)", async () => {
    const res = await fetch(`${baseUrl}/api/projects/validate-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Endpoint not found." });
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

  it("POST /api/projects/inspect-repository returns pending_setup when local remote does not match configured remote", async () => {
    const repoDir = path.join(tempDir, "wrong-remote-repo");
    await execStrict("git", ["init", repoDir], { envPolicy: "inherit" });
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict(
      "git",
      ["remote", "add", "origin", "https://github.com/my-org/local-repo.git"],
      { envPolicy: "inherit", cwd: repoDir },
    );
    await writeFile(path.join(repoDir, "README.md"), "# Test\n");
    await execStrict("git", ["add", "."], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["commit", "-m", "initial"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: repoDir,
        remote: "https://github.com/my-org/different-remote.git",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      isGitRepo: boolean;
      readiness: { status: string; message: string };
    };
    assert.equal(body.exists, true);
    assert.equal(body.isGitRepo, true);
    assert.equal(body.readiness.status, "pending_setup");
    assert.equal(
      body.readiness.message,
      "Local Git remote URL does not match configured remote.",
    );
  });

  it("POST /api/projects/inspect-repository returns current checkout branch as currentBranch", async () => {
    const repoDir = path.join(tempDir, "branch-check-repo");
    await execStrict("git", ["init", repoDir], { envPolicy: "inherit" });
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await writeFile(path.join(repoDir, "README.md"), "# Branch\n");
    await execStrict("git", ["add", "."], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["commit", "-m", "initial"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict(
      "git",
      ["checkout", "-b", "feature/inspection-terminology"],
      { envPolicy: "inherit", cwd: repoDir },
    );

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      isGitRepo: boolean;
      currentBranch: string;
      readiness: { status: string; message: string };
    };
    assert.equal(body.exists, true);
    assert.equal(body.isGitRepo, true);
    assert.equal(body.currentBranch, "feature/inspection-terminology");
  });

  it("POST /api/projects/inspect-repository returns pending_setup and does not report expectedRemote when local remote is missing", async () => {
    const repoDir = path.join(tempDir, "no-remote-repo");
    await execStrict("git", ["init", repoDir], { envPolicy: "inherit" });
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await writeFile(path.join(repoDir, "README.md"), "# No Remote\n");
    await execStrict("git", ["add", "."], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["commit", "-m", "initial"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: repoDir,
        remote: "https://github.com/my-org/expected-repo.git",
      }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      isGitRepo: boolean;
      remote?: string;
      readiness: { status: string; message: string };
    };
    assert.equal(body.exists, true);
    assert.equal(body.isGitRepo, true);
    assert.equal(body.remote, undefined);
    assert.equal(body.readiness.status, "pending_setup");
    assert.equal(
      body.readiness.message,
      "Local Git remote URL does not match configured remote.",
    );
  });

  it("POST /api/projects/inspect-repository does not fall back to main or default branch when HEAD is detached", async () => {
    const repoDir = path.join(tempDir, "detached-head-repo");
    await execStrict("git", ["init", repoDir], { envPolicy: "inherit" });
    await execStrict("git", ["config", "user.email", "dev@test.com"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["config", "user.name", "Dev"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await writeFile(path.join(repoDir, "README.md"), "# Detached\n");
    await execStrict("git", ["add", "."], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["commit", "-m", "initial"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });
    await execStrict("git", ["checkout", "--detach"], {
      envPolicy: "inherit",
      cwd: repoDir,
    });

    const res = await fetch(`${baseUrl}/api/projects/inspect-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: repoDir }),
    });

    assert.equal(res.status, 200);
    const body = (await res.json()) as {
      exists: boolean;
      isGitRepo: boolean;
      currentBranch?: string;
      readiness: { status: string; message: string };
    };
    assert.equal(body.exists, true);
    assert.equal(body.isGitRepo, true);
    assert.equal(body.currentBranch, undefined);
    assert.notEqual(body.currentBranch, "main");
    assert.equal(body.readiness.status, "pending_setup");
  });

  it("the removed /api/discovery namespace answers 404 (#192)", async () => {
    const res = await fetch(`${baseUrl}/api/discovery/validate-path`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: tempDir }),
    });

    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: "Endpoint not found." });
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
    assert.deepEqual(await res.json(), {
      ok: true,
      message: "Azure DevOps connection successful.",
    });
    // The probe received the project's STORED connection: recorded config plus
    // the secret merged back from per-project env storage.
    assert.equal(
      trackerVerifyCalls.at(-1)?.orgUrl,
      "https://dev.azure.com/testorg",
    );
    assert.equal(trackerVerifyCalls.at(-1)?.project, "TestProject");
    assert.equal(trackerVerifyCalls.at(-1)?.pat, "test-azure-pat-9999");
  });

  it("POST /api/projects/:id/tracker/test rejects malformed JSON with 400", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tracker/test`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{ malformed: true",
      },
    );
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.ok(body.error.includes("Invalid JSON"));
  });

  it("POST /api/projects/:id/tracker/test works with empty body (optional body contract)", async () => {
    const res = await fetch(
      `${baseUrl}/api/projects/${trackerProjId}/tracker/test`,
      {
        method: "POST",
      },
    );
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      ok: true,
      message: "Azure DevOps connection successful.",
    });
  });

  it("POST /api/projects/:id/tracker/test maps a provider throw to the normalized envelope without raw text", async () => {
    // A thrown provider failure crosses the boundary as the normalized
    // provider error (AUTH_INVALID → 401); the raw text, which may quote the
    // stored token, never reaches the client.
    trackerVerifyFailure = new Error(
      "verify exploded for token test-azure-pat-9999",
    );
    try {
      const res = await fetch(
        `${baseUrl}/api/projects/${trackerProjId}/tracker/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(res.status, 401);
      const body = (await res.json()) as {
        error: string;
        code: string;
        context: string;
      };
      assert.deepEqual(body, {
        error: "The credentials were rejected. Check the token and try again.",
        code: "AUTH_INVALID",
        context: "VERIFY",
      });
      const wire = JSON.stringify(body);
      assert.ok(!wire.includes("verify exploded"));
      assert.ok(!wire.includes("test-azure-pat-9999"));
    } finally {
      trackerVerifyFailure = null;
    }
  });

  it("tracker credentials and test endpoints fail closed with 400 when project has no tracker configured", async () => {
    const noTrackerProjId = `proj-no-tracker-${Date.now()}`;
    const { spyOn } = await import("bun:test");
    const configModule = await import("../src/config.js");
    const noTrackerProj = {
      id: noTrackerProjId,
      name: "No Tracker Project",
      workspacePath: tempDir,
      repositoryPath: tempDir,
      defaultBranch: "main",
      testCommand: "bun test",
      repositories: [],
      issueTracker: {} as never,
    };
    const spy = spyOn(configModule, "getProject").mockImplementation(
      async (id: string) => {
        if (id === noTrackerProjId) return noTrackerProj as never;
        return null;
      },
    );

    try {
      // PUT /tracker/credentials should fail closed with 400
      const credRes = await fetch(
        `${baseUrl}/api/projects/${noTrackerProjId}/tracker/credentials`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: "secret" }),
        },
      );
      assert.equal(credRes.status, 400);
      const credBody = (await credRes.json()) as { error: string };
      assert.ok(credBody.error.includes("Missing issue tracker provider"));

      // POST /tracker/test resolves the STORED connection, so a project with no
      // tracker fails closed with 400 for the same reason the scope action does.
      const testRes = await fetch(
        `${baseUrl}/api/projects/${noTrackerProjId}/tracker/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      assert.equal(testRes.status, 400);
      const testBody = (await testRes.json()) as { error: string };
      assert.ok(testBody.error.includes("has no issue tracker configured"));
    } finally {
      spy.mockRestore();
    }
  });

  it("POST /api/projects/:id/migrate blocks migration with 409 if project has active run", async () => {
    const activeRunId = `run-active-${Date.now()}`;
    const runRepo = repos.runs;
    runRepo.create({
      id: activeRunId,
      projectId: trackerProjId,
      projectName: "Tracker Test Product",
      ticket: { id: "T-1", title: "Test", acceptanceCriteria: [] },
      plan: "test",
      branch: "test",
      status: "executing",
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
    forceRunStatus(repos.db, activeRunId, "stopped");
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
    assert.deepEqual(await testRes.json(), {
      ok: true,
      message: "GitHub connection successful.",
    });
  });

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
    assert.deepEqual(await testRes.json(), {
      ok: true,
      message: "Jira Cloud connection successful.",
    });
  });

  it("POST /api/projects creates and persists a 14-repository Azure/Converso project with real metadata (#114)", async () => {
    const fourteenRepoProjId = `proj-azure-converso-14-${Date.now()}`;
    const workspaceRoot = path.join(tempDir, "converso-workspace");

    // Exactly 14 repositories matching the Azure/Converso scenario
    // Primary repository ("Converso") is at index 0 as sent by the wizard
    const expectedFourteenRepos = [
      {
        id: "repo-12-converso",
        name: "Converso",
        path: path.join(workspaceRoot, "Converso"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/Converso",
        role: "backend",
      },
      {
        id: "repo-1-ai-engine",
        name: "ai-engine",
        path: path.join(workspaceRoot, "ai-engine"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/ai-engine",
        role: "service",
      },
      {
        id: "repo-2-vendifai-custom",
        name: "Vendifai-Custom",
        path: path.join(workspaceRoot, "Vendifai-Custom"),
        defaultBranch: "master",
        remote: "https://dev.azure.com/xynotech/Converso/_git/Vendifai-Custom",
        role: "service",
      },
      {
        id: "repo-3-ai-docs",
        name: "ai-docs",
        path: path.join(workspaceRoot, "ai-docs"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/ai-docs",
        role: "documentation",
      },
      {
        id: "repo-4-shopify-plugin",
        name: "Shopify-Plugin",
        path: path.join(workspaceRoot, "Shopify-Plugin"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/Shopify-Plugin",
        role: "service",
      },
      {
        id: "repo-5-converso-frontend",
        name: "Converso-Front-End",
        path: path.join(workspaceRoot, "Converso-Front-End"),
        defaultBranch: "main",
        remote:
          "https://dev.azure.com/xynotech/Converso/_git/Converso-Front-End",
        role: "frontend",
      },
      {
        id: "repo-6-vendifai-extension",
        name: "VendifAi-Extension",
        path: path.join(workspaceRoot, "VendifAi-Extension"),
        defaultBranch: "main",
        remote:
          "https://dev.azure.com/xynotech/Converso/_git/VendifAi-Extension",
        role: "frontend",
      },
      {
        id: "repo-7-converso-infra-prod",
        name: "converso-infra-prod",
        path: path.join(workspaceRoot, "converso-infra-prod"),
        defaultBranch: "main",
        remote:
          "https://dev.azure.com/xynotech/Converso/_git/converso-infra-prod",
        role: "infrastructure",
      },
      {
        id: "repo-8-converso-portal",
        name: "converso-portal",
        path: path.join(workspaceRoot, "converso-portal"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/converso-portal",
        role: "frontend",
      },
      {
        id: "repo-9-ticket-agent",
        name: "ticket-agent",
        path: path.join(workspaceRoot, "ticket-agent"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/ticket-agent",
        role: "worker",
      },
      {
        id: "repo-10-rbre",
        name: "RBRE",
        path: path.join(workspaceRoot, "RBRE"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/RBRE",
        role: "service",
      },
      {
        id: "repo-11-vendifai-pulse",
        name: "Vendifai-pulse",
        path: path.join(workspaceRoot, "Vendifai-pulse"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/Vendifai-pulse",
        role: "service",
      },
      {
        id: "repo-13-vendifiai-test-automation",
        name: "vendifiai-test-automation",
        path: path.join(workspaceRoot, "vendifiai-test-automation"),
        defaultBranch: "main",
        remote:
          "https://dev.azure.com/xynotech/Converso/_git/vendifiai-test-automation",
        role: "other",
      },
      {
        id: "repo-14-converso-infra",
        name: "converso-infra",
        path: path.join(workspaceRoot, "converso-infra"),
        defaultBranch: "main",
        remote: "https://dev.azure.com/xynotech/Converso/_git/converso-infra",
        role: "infrastructure",
      },
    ];

    assert.equal(expectedFourteenRepos.length, 14);

    const primaryExpected = expectedFourteenRepos[0];
    assert.ok(primaryExpected);

    // Exact payload structure matching the wizard Step 6 submission
    // Notice: no PAT or credential fields are included in the payload
    const payload = {
      id: fourteenRepoProjId,
      name: "Converso",
      workspacePath: workspaceRoot,
      repositoryPath: primaryExpected.path,
      defaultBranch: primaryExpected.defaultBranch,
      issueTracker: {
        provider: "azure",
        connectionId: "azure",
        projectId: "Converso",
        azure: {
          orgUrl: "https://dev.azure.com/xynotech",
          project: "Converso",
        },
      },
      repositories: expectedFourteenRepos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        path: repo.path,
        defaultBranch: repo.defaultBranch,
        remote: repo.remote,
        role: repo.role,
      })),
    };

    // 1. Real HTTP POST /api/projects without mocking
    const postRes = await fetch(`${baseUrl}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    assert.equal(postRes.status, 201);
    const postBody = (await postRes.json()) as {
      id: string;
      name: string;
      repositories: Array<{ id: string; name: string }>;
    };
    assert.equal(postBody.id, fourteenRepoProjId);
    assert.equal(postBody.name, "Converso");
    assert.equal(postBody.repositories.length, 14);

    // 2. Real HTTP GET /api/projects/:id to read back created project
    const getRes = await fetch(`${baseUrl}/api/projects/${fourteenRepoProjId}`);
    assert.equal(getRes.status, 200);
    const retrievedProject = (await getRes.json()) as {
      id: string;
      name: string;
      workspacePath?: string;
      repositoryPath: string;
      defaultBranch: string;
      issueTracker?: {
        provider: string;
        connectionId?: string;
        projectId?: string;
        azure?: {
          orgUrl: string;
          project: string;
        };
      };
      repositories: Array<{
        id: string;
        name: string;
        path: string;
        defaultBranch: string;
        remote?: string;
        role?: string;
      }>;
    };

    // 3. Assert exactly 14 repositories returned and order preserved
    assert.equal(retrievedProject.repositories.length, 14);

    // 4. Verify first repository is explicitly the primary repository
    const primaryRepo = retrievedProject.repositories[0];
    assert.ok(primaryRepo);
    assert.equal(primaryRepo.id, "repo-12-converso");
    assert.equal(primaryRepo.name, "Converso");
    assert.equal(primaryRepo.path, path.resolve(primaryExpected.path));
    assert.equal(primaryRepo.defaultBranch, "main");
    assert.equal(primaryRepo.role, "backend");
    assert.equal(
      primaryRepo.remote,
      "https://dev.azure.com/xynotech/Converso/_git/Converso",
    );
    // Project-level pointers match primary repository
    assert.equal(retrievedProject.repositoryPath, primaryRepo.path);
    assert.equal(retrievedProject.defaultBranch, primaryRepo.defaultBranch);

    // 5. Verify all 14 repositories preserve their exact metadata and ordering
    for (let i = 0; i < 14; i++) {
      const actual = retrievedProject.repositories[i];
      const expected = expectedFourteenRepos[i];
      assert.ok(actual, `Repo index ${i} actual repo must exist`);
      assert.ok(expected, `Repo index ${i} expected repo must exist`);
      assert.equal(actual.id, expected.id, `Repo index ${i} ID mismatch`);
      assert.equal(actual.name, expected.name, `Repo index ${i} name mismatch`);
      assert.equal(
        actual.path,
        path.resolve(expected.path),
        `Repo index ${i} path mismatch`,
      );
      assert.equal(
        actual.defaultBranch,
        expected.defaultBranch,
        `Repo index ${i} branch mismatch`,
      );
      assert.equal(
        actual.remote,
        expected.remote,
        `Repo index ${i} remote mismatch`,
      );
      assert.equal(actual.role, expected.role, `Repo index ${i} role mismatch`);
    }

    // 6. Verify actual disk persistence in projects.json (not just in-memory handler)
    const rawDiskConfig = await readFile(projectsJsonPath, "utf-8");
    const parsedConfig = JSON.parse(rawDiskConfig) as {
      projects: Array<{
        id: string;
        name: string;
        repositories: Array<{
          id: string;
          name: string;
          path: string;
          defaultBranch: string;
          remote?: string;
          role?: string;
        }>;
        issueTracker?: Record<string, unknown>;
      }>;
    };

    const persistedProject = parsedConfig.projects.find(
      (p) => p.id === fourteenRepoProjId,
    );
    assert.ok(
      persistedProject,
      "Project must be written and persisted to projects.json",
    );
    assert.equal(persistedProject.repositories.length, 14);

    type PersistedRepo = {
      id: string;
      name: string;
      path: string;
      defaultBranch: string;
      remote?: string;
      role?: string;
    };

    for (let i = 0; i < 14; i++) {
      const persistedRepo: PersistedRepo | undefined =
        persistedProject.repositories[i];
      const expected = expectedFourteenRepos[i];
      assert.ok(persistedRepo);
      assert.ok(expected);
      assert.equal(persistedRepo.id, expected.id);
      assert.equal(persistedRepo.name, expected.name);
      assert.equal(persistedRepo.path, path.resolve(expected.path));
      assert.equal(persistedRepo.defaultBranch, expected.defaultBranch);
      assert.equal(persistedRepo.remote, expected.remote);
      assert.equal(persistedRepo.role, expected.role);
    }

    // 7. Secret safety: verify NO PAT, token, password, or credentials leaked into persisted config
    const secretKeys = [
      "pat",
      "token",
      "password",
      "secret",
      "credentials",
      "accesstoken",
      "apikey",
    ];

    const verifyNoSecretKeys = (obj: unknown, prefix = ""): void => {
      if (!obj || typeof obj !== "object") return;
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        const lowerKey = key.toLowerCase();
        for (const secret of secretKeys) {
          assert.notEqual(
            lowerKey,
            secret,
            `Persisted project contains sensitive key "${fullKey}"`,
          );
        }
        if (typeof value === "object" && value !== null) {
          verifyNoSecretKeys(value, fullKey);
        }
      }
    };

    verifyNoSecretKeys(persistedProject);
    verifyNoSecretKeys(retrievedProject);
  });
});
