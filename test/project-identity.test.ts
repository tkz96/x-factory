import { describe, expect, test } from "bun:test";
import { normalizeGitRemoteUrl } from "../src/shared/git-remote.js";
import {
  findDuplicateProject,
  normalizeAzureOrganization,
  normalizeAzureProject,
  normalizeGitHubRepository,
  normalizeProjectId,
} from "../src/shared/project-identity.js";
import type { Project } from "../src/shared/types.js";

function createMockProject(
  id: string,
  name: string,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  tracker: any,
  archived = false,
  repositories: Array<{ remote?: string; role?: string }> = [],
): Project {
  return {
    id,
    name,
    issueTracker: tracker,
    repositories: repositories as Project["repositories"],
    repositoryPath: "/mock",
    defaultBranch: "main",
    testCommand: "test",
    archived,
  };
}

describe("Duplicate Project Detection (Shared Logic)", () => {
  test("Test 1: Exact local project ID collision", () => {
    const existing = createMockProject("my-project", "Existing Project", {
      provider: "github",
      github: { repo: "owner/old" },
    });

    // Exact match
    const exact = findDuplicateProject(
      [existing],
      "my-project",
      "github",
      "",
      "owner/new",
    );
    expect(exact.isDuplicate).toBe(true);
    expect(exact.type).toBe("id_collision");
    expect(exact.existingProject?.id).toBe("my-project");

    // Case difference
    const caseDiff = findDuplicateProject(
      [existing],
      "MY-PROJECT",
      "github",
      "",
      "owner/new",
    );
    expect(caseDiff.isDuplicate).toBe(true);
    expect(caseDiff.type).toBe("id_collision");

    // Separator differences that canonical rule considers equivalent
    const underscoreDiff = findDuplicateProject(
      [existing],
      "my_project",
      "github",
      "",
      "owner/new",
    );
    expect(underscoreDiff.isDuplicate).toBe(true);
    expect(underscoreDiff.type).toBe("id_collision");

    const dotDiff = findDuplicateProject(
      [existing],
      "my.project",
      "github",
      "",
      "owner/new",
    );
    expect(dotDiff.isDuplicate).toBe(true);
    expect(dotDiff.type).toBe("id_collision");

    // Clearly different IDs must remain different
    const different = findDuplicateProject(
      [existing],
      "other-project",
      "github",
      "",
      "owner/new",
    );
    expect(different.isDuplicate).toBe(false);
  });

  test("Test 2: Same Azure external project with different local ID", () => {
    const existing = createMockProject("converso-prod", "Existing Converso", {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/xynotech", project: "Converso" },
    });

    const result = findDuplicateProject(
      [existing],
      "converso-new",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
    expect(result.existingProject?.id).toBe("converso-prod");
  });

  test("Test 3: Same local ID but different Azure external target must remain id_collision", () => {
    const existing = createMockProject("converso", "Existing Converso", {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/xynotech", project: "Converso" },
    });

    const result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/different-org",
      "different-project",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("id_collision");
    expect(result.existingProject?.id).toBe("converso");
  });

  test("Test 4: Archived duplicate preserves archived status", () => {
    const existing = createMockProject(
      "converso-old",
      "Archived Converso",
      {
        provider: "azure",
        azure: {
          orgUrl: "https://dev.azure.com/xynotech",
          project: "Converso",
        },
      },
      true,
    );

    const result = findDuplicateProject(
      [existing],
      "converso-new",
      "azure",
      "https://dev.azure.com/xynotech",
      "Converso",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.existingProject?.archived).toBe(true);
  });

  test("Test 5: Same GitHub repository with case normalization", () => {
    const existing = createMockProject("my-repo", "My Repo", {
      provider: "github",
      github: { repo: "facebook/react" },
    });

    const result = findDuplicateProject(
      [existing],
      "my-new-repo",
      "github",
      "",
      "FACEBOOK/REACT",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
    expect(result.existingProject?.id).toBe("my-repo");
  });

  test("Test 6: GitHub false positive", () => {
    const existing = createMockProject("my-repo", "My Repo", {
      provider: "github",
      github: { repo: "facebook/react" },
    });

    const diffOwner = findDuplicateProject(
      [existing],
      "diff-owner",
      "github",
      "",
      "another/react",
    );
    expect(diffOwner.isDuplicate).toBe(false);

    const diffRepo = findDuplicateProject(
      [existing],
      "diff-repo",
      "github",
      "",
      "facebook/relay",
    );
    expect(diffRepo.isDuplicate).toBe(false);
  });

  test("Test 7: Azure false positive", () => {
    const existing = createMockProject("my-azure", "My Azure", {
      provider: "azure",
      azure: {
        orgUrl: "https://dev.azure.com/xynotech",
        project: "ProjectA",
      },
    });

    // Different project in same org
    const diffProj = findDuplicateProject(
      [existing],
      "new-id",
      "azure",
      "https://dev.azure.com/xynotech",
      "ProjectB",
    );
    expect(diffProj.isDuplicate).toBe(false);

    // Different org with same project name
    const diffOrg = findDuplicateProject(
      [existing],
      "new-id",
      "azure",
      "https://dev.azure.com/other-org",
      "ProjectA",
    );
    expect(diffOrg.isDuplicate).toBe(false);
  });

  test("Test 8: Equivalent discovered repository remotes match existing project", () => {
    const existing = createMockProject(
      "existing-repo-proj",
      "Existing Repo Proj",
      {
        provider: "azure",
        azure: { orgUrl: "https://dev.azure.com/org", project: "proj" },
      },
      false,
      [{ remote: "https://github.com/owner/core-repo" }],
    );

    // git@ SSH
    const sshResult = findDuplicateProject(
      [existing],
      "new-proj-id",
      "azure",
      "https://dev.azure.com/org",
      "other-proj",
      [{ remote: "git@github.com:OWNER/core-repo.git" }],
    );
    expect(sshResult.isDuplicate).toBe(true);
    expect(sshResult.type).toBe("external_identity");
    expect(sshResult.existingProject?.id).toBe("existing-repo-proj");

    // ssh:// with trailing slash
    const sshProtoResult = findDuplicateProject(
      [existing],
      "new-proj-id",
      "azure",
      "https://dev.azure.com/org",
      "other-proj",
      [{ remote: "ssh://git@github.com/owner/core-repo.git/" }],
    );
    expect(sshProtoResult.isDuplicate).toBe(true);
    expect(sshProtoResult.type).toBe("external_identity");
  });

  test("Test 9: Different repository remotes do not match", () => {
    const existing = createMockProject(
      "existing-repo-proj",
      "Existing Repo Proj",
      {
        provider: "azure",
        azure: { orgUrl: "https://dev.azure.com/org", project: "proj" },
      },
      false,
      [{ remote: "https://github.com/owner/core-repo" }],
    );

    const result = findDuplicateProject(
      [existing],
      "new-proj-id",
      "azure",
      "https://dev.azure.com/org",
      "other-proj",
      [{ remote: "https://github.com/owner/other-repo" }],
    );
    expect(result.isDuplicate).toBe(false);
  });

  test("Test 10: Changing ID/external identity removes a previous duplicate warning", () => {
    const existing = createMockProject("converso-prod", "Existing", {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/xynotech", project: "Converso" },
    });

    // Initial state: matches external identity
    let result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso",
    );
    expect(result.isDuplicate).toBe(true);

    // Change Azure project name -> clears duplicate
    result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso-new",
    );
    expect(result.isDuplicate).toBe(false);

    // Set local ID to collision -> duplicate again
    result = findDuplicateProject(
      [existing],
      "converso-prod",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso-new",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("id_collision");

    // Change local ID -> clears duplicate
    result = findDuplicateProject(
      [existing],
      "converso-different",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso-new",
    );
    expect(result.isDuplicate).toBe(false);
  });

  describe("Normalization Helpers", () => {
    test("normalizeProjectId", () => {
      expect(normalizeProjectId("  My Project  ")).toBe("my-project");
      expect(normalizeProjectId("My_Project.Name")).toBe("my-project-name");
      expect(normalizeProjectId("---leading-and-trailing---")).toBe(
        "leading-and-trailing",
      );
      expect(normalizeProjectId("")).toBe("");
    });

    test("normalizeAzureOrganization", () => {
      expect(
        normalizeAzureOrganization("https://dev.azure.com/xynotech/"),
      ).toBe("https://dev.azure.com/xynotech");
      expect(normalizeAzureOrganization("dev.azure.com/xynotech")).toBe(
        "https://dev.azure.com/xynotech",
      );
      expect(normalizeAzureOrganization("https://dev.azure.com/XYNOTECH")).toBe(
        "https://dev.azure.com/xynotech",
      );
      expect(normalizeAzureOrganization("")).toBe("");
    });

    test("normalizeAzureProject", () => {
      expect(normalizeAzureProject("  Converso/  ")).toBe("converso");
      expect(normalizeAzureProject("CONVERSO")).toBe("converso");
      expect(normalizeAzureProject("")).toBe("");
    });

    test("normalizeGitHubRepository", () => {
      expect(
        normalizeGitHubRepository("https://github.com/facebook/react.git"),
      ).toBe("facebook/react");
      expect(
        normalizeGitHubRepository("git@github.com:facebook/react.git"),
      ).toBe("facebook/react");
      expect(normalizeGitHubRepository("FACEBOOK/REACT")).toBe(
        "facebook/react",
      );
      expect(normalizeGitHubRepository("")).toBe("");
    });

    test("normalizeGitRemoteUrl", () => {
      expect(normalizeGitRemoteUrl("https://github.com/owner/repo.git")).toBe(
        "github:owner/repo",
      );
      expect(normalizeGitRemoteUrl("git@github.com:owner/repo.git")).toBe(
        "github:owner/repo",
      );
      expect(
        normalizeGitRemoteUrl("ssh://git@github.com/owner/repo.git/"),
      ).toBe("github:owner/repo");
      expect(
        normalizeGitRemoteUrl("https://dev.azure.com/org/proj/_git/repo.git/"),
      ).toBe("azure:org/proj/repo");
      expect(
        normalizeGitRemoteUrl("git@ssh.dev.azure.com:v3/org/proj/repo"),
      ).toBe("azure:org/proj/repo");
      expect(
        normalizeGitRemoteUrl("https://org.visualstudio.com/proj/_git/repo"),
      ).toBe("azure:org/proj/repo");
      expect(
        normalizeGitRemoteUrl("https://gitlab.com/my-group/my-repo.git"),
      ).toBe("gitlab.com/my-group/my-repo");
      expect(normalizeGitRemoteUrl("")).toBe("");
    });
  });
});
