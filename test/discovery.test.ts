// test/discovery.test.ts — Unit tests for platform-agnostic repository discovery.

import { describe, it } from "bun:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  AzureDevOpsRepositoryDiscovery,
  discoverRepositories,
  GitHubRepositoryDiscovery,
  getDiscoveryProvider,
  JiraRepositoryDiscovery,
  LocalWorkspaceRepositoryDiscovery,
} from "../src/discovery/index.js";
import { execStrict } from "../src/proc.js";

describe("Repository Discovery Providers", () => {
  it("resolves providers from registry", () => {
    assert.ok(
      getDiscoveryProvider("azure") instanceof AzureDevOpsRepositoryDiscovery,
    );
    assert.ok(
      getDiscoveryProvider("github") instanceof GitHubRepositoryDiscovery,
    );
    assert.ok(getDiscoveryProvider("jira") instanceof JiraRepositoryDiscovery);
    assert.ok(
      getDiscoveryProvider("local") instanceof
        LocalWorkspaceRepositoryDiscovery,
    );
    assert.throws(
      () => getDiscoveryProvider("unknown"),
      /Unsupported discovery provider/,
    );
  });

  describe("AzureDevOpsRepositoryDiscovery", () => {
    it("validates required inputs", async () => {
      const provider = new AzureDevOpsRepositoryDiscovery();
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "",
            project: "p",
            pat: "pat",
          }),
        /Organization URL is required/,
      );
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "",
            pat: "pat",
          }),
        /Project name is required/,
      );
      await assert.rejects(
        () =>
          provider.listRepositories({
            provider: "azure",
            orgUrl: "https://dev.azure.com/org",
            project: "p",
            pat: "",
          }),
        /Personal Access Token/,
      );
    });

    it("extracts organization and project from Azure DevOps URLs", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(
            String(url).includes(
              "https://dev.azure.com/xynotech/Converso/_apis/git/repositories",
            ),
          );
          return new Response(JSON.stringify({ value: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        const repos = await provider.listRepositories({
          provider: "azure",
          primaryRepo: "https://dev.azure.com/xynotech/Converso",
          pat: "test-pat",
        });
        assert.equal(repos.length, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("normalizes Azure DevOps repositories", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(String(url).includes("_apis/git/repositories"));
          return new Response(
            JSON.stringify({
              value: [
                {
                  id: "az-repo-1",
                  name: "vendifai-web",
                  remoteUrl: "https://dev.azure.com/org/proj/_git/vendifai-web",
                  defaultBranch: "refs/heads/main",
                },
                {
                  id: "az-repo-2",
                  name: "vendifai-api",
                  url: "https://dev.azure.com/org/proj/_git/vendifai-api",
                  defaultBranch: "refs/heads/master",
                },
              ],
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const provider = new AzureDevOpsRepositoryDiscovery();
        const repos = await provider.listRepositories({
          provider: "azure",
          orgUrl: "https://dev.azure.com/org",
          project: "proj",
          pat: "secret-pat",
        });

        assert.equal(repos.length, 2);
        assert.equal(repos[0].name, "vendifai-web");
        assert.equal(repos[0].defaultBranch, "main");
        assert.equal(
          repos[0].remote,
          "https://dev.azure.com/org/proj/_git/vendifai-web",
        );
        assert.equal(repos[1].defaultBranch, "master");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("handles Azure DevOps error responses cleanly", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () =>
          new Response("Unauthorized", {
            status: 401,
          })) as unknown as typeof fetch;
        const provider = new AzureDevOpsRepositoryDiscovery();
        await assert.rejects(
          () =>
            provider.listRepositories({
              provider: "azure",
              orgUrl: "https://dev.azure.com/org",
              project: "p",
              pat: "bad",
            }),
          /authentication failed/,
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("GitHubRepositoryDiscovery", () => {
    it("normalizes GitHub repositories", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async () => {
          return new Response(
            JSON.stringify([
              {
                id: 12345,
                name: "vendifai-frontend",
                clone_url: "https://github.com/vendifai/frontend.git",
                html_url: "https://github.com/vendifai/frontend",
                default_branch: "main",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const repos = await discoverRepositories({
          provider: "github",
          repoOwner: "vendifai",
          token: "ghp_mock",
        });

        assert.equal(repos.length, 1);
        assert.equal(repos[0].id, "12345");
        assert.equal(repos[0].name, "vendifai-frontend");
        assert.equal(
          repos[0].remote,
          "https://github.com/vendifai/frontend.git",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("JiraRepositoryDiscovery", () => {
    it("discovers Jira components as repository candidates", async () => {
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (async (url: string | URL | Request) => {
          assert.ok(
            String(url).includes("/rest/api/3/project/PROJ/components"),
          );
          return new Response(
            JSON.stringify([
              {
                id: "1001",
                name: "vendifai-frontend",
                description: "UI web app",
              },
              {
                id: "1002",
                name: "vendifai-backend",
                description: "API microservice",
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }) as unknown as typeof fetch;

        const repos = await discoverRepositories({
          provider: "jira",
          project: "PROJ",
          jiraHost: "company.atlassian.net",
          jiraEmail: "dev@company.com",
          jiraToken: "api-token",
        });

        assert.equal(repos.length, 2);
        assert.equal(repos[0].name, "vendifai-frontend");
        assert.equal(repos[1].name, "vendifai-backend");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("falls back to local workspace discovery when workspacePath is supplied", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xf-jira-local-"));
      try {
        const repoA = path.join(root, "repo-jira-a");
        await execStrict("git", ["init", repoA]);
        await execStrict("git", ["config", "user.email", "a@test.com"], {
          cwd: repoA,
        });
        await execStrict("git", ["config", "user.name", "A"], { cwd: repoA });

        const repos = await discoverRepositories({
          provider: "jira",
          project: "PROJ",
          workspacePath: root,
        });

        assert.equal(repos.length, 1);
        assert.equal(repos[0].name, "repo-jira-a");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("LocalWorkspaceRepositoryDiscovery", () => {
    it("discovers git repositories in local directory", async () => {
      const root = await mkdtemp(path.join(tmpdir(), "xf-local-disc-"));
      try {
        const repoA = path.join(root, "repo-a");
        const repoB = path.join(root, "repo-b");
        const notRepo = path.join(root, "not-repo");

        await execStrict("git", ["init", repoA]);
        await execStrict("git", ["config", "user.email", "a@test.com"], {
          cwd: repoA,
        });
        await execStrict("git", ["config", "user.name", "A"], { cwd: repoA });
        await execStrict(
          "git",
          ["remote", "add", "origin", "https://github.com/org/repo-a.git"],
          { cwd: repoA },
        );

        await execStrict("git", ["init", repoB]);
        await execStrict("git", ["config", "user.email", "b@test.com"], {
          cwd: repoB,
        });
        await execStrict("git", ["config", "user.name", "B"], { cwd: repoB });

        await mkdir(notRepo, { recursive: true });
        await writeFile(path.join(notRepo, "file.txt"), "hello");

        const provider = new LocalWorkspaceRepositoryDiscovery();
        const discovered = await provider.listRepositories({
          provider: "local",
          workspacePath: root,
        });

        assert.equal(discovered.length, 2);
        const names = discovered.map((d) => d.name).sort();
        assert.deepEqual(names, ["repo-a", "repo-b"]);

        const repoADiscovered = discovered.find((d) => d.name === "repo-a");
        assert.equal(
          repoADiscovered?.remote,
          "https://github.com/org/repo-a.git",
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });
});
