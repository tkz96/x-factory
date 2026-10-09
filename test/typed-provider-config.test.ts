// test/typed-provider-config.test.ts — Typed provider configuration (#186).
//
// Acceptance criteria:
// 1. GitHub Enterprise base URL is a declared, validated schema field
// 2. Adapters do not search for aliased or nested keys
// 3. The separate hard-coded per-provider input schema is reconciled with provider schemas

import { describe, expect, it } from "bun:test";
import {
  IssueTrackerInputSchema,
  validateProjectInput,
} from "../src/config-schema.js";
import { createAzureProvider } from "../src/providers/azure-module.js";
import { parseProviderConfig } from "../src/providers/config-validation.js";
import {
  createGithubProvider,
  githubConfigSchema,
  githubProvider,
  resolveGitHubConfig,
} from "../src/providers/github-module.js";
import type { HttpTransport } from "../src/providers/http.js";
import { migrateLegacyProviderConfig } from "../src/providers/legacy-migration.js";
import { buildProjectMigrationPlan } from "../src/providers/project-config.js";
import { serializeProviderConfigSchema } from "../src/providers/serializer.js";
import type { Project } from "../src/shared/types.js";

describe("Typed provider config (#186)", () => {
  describe("Acceptance Criterion 1: GitHub Enterprise base URL is a declared, validated schema field", () => {
    it("declares baseUrl in githubConfigSchema with url type and metadata", () => {
      const fields = serializeProviderConfigSchema(githubProvider.configSchema);
      const baseUrlField = fields.find((f) => f.name === "baseUrl");

      expect(baseUrlField).toBeDefined();
      expect(baseUrlField?.type).toBe("url");
      expect(baseUrlField?.required).toBe(false);
      expect(baseUrlField?.label).toBe("Base URL");
    });

    it("validates that baseUrl must be a valid URL when provided", () => {
      const valid = githubConfigSchema.safeParse({
        token: "ghp_valid_token",
        baseUrl: "https://github.enterprise.acme.com/api/v3",
      });
      expect(valid.success).toBe(true);

      const invalid = githubConfigSchema.safeParse({
        token: "ghp_valid_token",
        baseUrl: "not-a-valid-url",
      });
      expect(invalid.success).toBe(false);
    });

    it("preserves baseUrl through parseProviderConfig", () => {
      const parsed = parseProviderConfig(githubProvider.configSchema, {
        token: "ghp_test_token",
        baseUrl: "https://ghe.internal.net/api/v3",
        repoOwner: "acme",
        repository: "backend",
      });
      expect(parsed.ok).toBe(true);
      if (parsed.ok) {
        expect(parsed.config.baseUrl).toBe("https://ghe.internal.net/api/v3");
        expect(parsed.config.token).toBe("ghp_test_token");
        expect(parsed.config.repoOwner).toBe("acme");
        expect(parsed.config.repository).toBe("backend");
      }
    });

    it("routes provider HTTP requests to the declared baseUrl", async () => {
      const recordedUrls: string[] = [];
      const mockFetch: HttpTransport = async (input) => {
        const urlStr =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        recordedUrls.push(urlStr);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      };

      const provider = createGithubProvider({ fetchFn: mockFetch });
      await provider.listRepositories?.({
        token: "ghp_token",
        repoOwner: "octocat",
        baseUrl: "https://ghe.internal.net/api/v3",
      });

      expect(recordedUrls.length).toBeGreaterThan(0);
      expect(recordedUrls[0]).toContain(
        "https://ghe.internal.net/api/v3/orgs/octocat/repos",
      );
    });
  });

  describe("Acceptance Criterion 2: Adapters do not search for aliased or nested keys", () => {
    it("GitHub adapter does not search for aliased keys (owner, repo, githubToken)", () => {
      const aliasedConfig = {
        token: "ghp_test",
        owner: "acme",
        repo: "core",
      };
      const resolved = resolveGitHubConfig(aliasedConfig);

      // Does not pick up owner from `owner` or repo from `repo`
      expect(resolved.owner).toBeUndefined();
      expect(resolved.repo).toBeUndefined();
      expect(resolved.token).toBe("ghp_test");

      // Only declared schema fields are read
      const typedConfig = {
        token: "ghp_test",
        repoOwner: "acme",
        repository: "core",
      };
      const resolvedTyped = resolveGitHubConfig(typedConfig);
      expect(resolvedTyped.owner).toBe("acme");
      expect(resolvedTyped.repo).toBe("core");
      expect(resolvedTyped.token).toBe("ghp_test");
    });

    it("GitHub adapter does not search for nested keys (gitHost, github, tracker, connections)", () => {
      const nestedConfig = {
        gitHost: {
          token: "ghp_nested",
          repoOwner: "enterprise-org",
          repository: "backend-service",
        },
      };
      const resolved = resolveGitHubConfig(nestedConfig);
      expect(resolved.token).toBeUndefined();
      expect(resolved.owner).toBeUndefined();
      expect(resolved.repo).toBeUndefined();
    });

    it("Azure adapter does not search for nested keys (azure, tracker, gitHost)", async () => {
      const provider = createAzureProvider();
      // Nested config without top-level orgUrl / project fails schema validation directly
      const nestedAzure = {
        azure: {
          orgUrl: "https://dev.azure.com/acme-corp",
          project: "Backend",
        },
      };
      await expect(provider.verifyCredentials(nestedAzure)).rejects.toThrow(
        /Invalid Azure configuration/,
      );
    });

    it("collapses GitHub alias search and Azure nested-key search into one legacy-migration step", () => {
      // GitHub legacy migration
      const legacyGitHub = migrateLegacyProviderConfig("github", {
        repo: "acme/rocket",
        owner: "acme",
        githubToken: "ghp_legacy",
      });
      expect(legacyGitHub.repoOwner).toBe("acme");
      expect(legacyGitHub.repository).toBe("rocket");
      expect(legacyGitHub.token).toBe("ghp_legacy");

      // Azure legacy migration from nested containers
      const legacyAzure = migrateLegacyProviderConfig("azure", {
        tracker: {
          orgUrl: "https://dev.azure.com/acme-corp",
          project: "Backend",
        },
        pat: "pat_legacy",
      });
      expect(legacyAzure.orgUrl).toBe("https://dev.azure.com/acme-corp");
      expect(legacyAzure.project).toBe("Backend");
      expect(legacyAzure.pat).toBe("pat_legacy");

      // Rejects conflicting legacy configurations at the migration step
      expect(() =>
        migrateLegacyProviderConfig("github", {
          repoOwner: "org-alpha",
          github: { repoOwner: "org-beta" },
        }),
      ).toThrow(/Configuration mismatch/);

      expect(() =>
        migrateLegacyProviderConfig("azure", {
          orgUrl: "https://dev.azure.com/acme-corp",
          tracker: { orgUrl: "https://dev.azure.com/other-corp" },
        }),
      ).toThrow(/Configuration mismatch/);
    });
  });

  describe("Acceptance Criterion 3: The separate hard-coded per-provider input schema is reconciled with provider schemas", () => {
    it("IssueTrackerInputSchema accepts baseUrl on github tracker", () => {
      const parsed = IssueTrackerInputSchema.safeParse({
        provider: "github",
        github: {
          repoOwner: "acme",
          repository: "web",
          baseUrl: "https://ghe.internal.corp/api/v3",
          requiredLabel: "agentic-workflow",
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("IssueTrackerInputSchema accepts jira tracker without project (matching jiraConfigSchema)", () => {
      const parsed = IssueTrackerInputSchema.safeParse({
        provider: "jira",
        jira: {
          host: "https://acme.atlassian.net",
          email: "dev@acme.com",
        },
      });
      expect(parsed.success).toBe(true);
    });

    it("validateProjectInput accepts a project with GitHub Enterprise baseUrl", () => {
      const project = validateProjectInput({
        id: "ghe-project",
        name: "GHE Project",
        repositoryPath: "/tmp/repo",
        issueTracker: {
          provider: "github",
          github: {
            repoOwner: "acme",
            repository: "core",
            baseUrl: "https://ghe.company.com/api/v3",
          },
        },
      });
      expect(project.issueTracker?.github?.baseUrl).toBe(
        "https://ghe.company.com/api/v3",
      );
    });

    it("ProjectMigrationInput accepts baseUrl, repoOwner, repository on github", () => {
      const plan = buildProjectMigrationPlan(
        {
          id: "proj-1",
          name: "Project 1",
          repositoryPath: "/tmp/repo",
          defaultBranch: "main",
          issueTracker: { provider: "jira" },
        } as unknown as Project,
        {
          targetProvider: "github",
          github: {
            repoOwner: "octocat",
            repository: "hello-world",
            baseUrl: "https://ghe.example.com/api/v3",
          },
          secrets: { token: "ghp_token" },
        },
      );
      expect(plan.newProject.issueTracker?.github?.baseUrl).toBe(
        "https://ghe.example.com/api/v3",
      );
    });
  });
});
