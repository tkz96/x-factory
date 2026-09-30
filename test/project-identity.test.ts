import { describe, expect, test } from "bun:test";
import {
  findDuplicateProject,
  normalizeAzureOrganization,
} from "../src/shared/project-identity.js";
import type { Project } from "../src/shared/types.js";

function createMockProject(
  id: string,
  name: string,
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  tracker: any,
  archived = false,
): Project {
  return {
    id,
    name,
    issueTracker: tracker,
    repositories: [],
    repositoryPath: "/mock",
    defaultBranch: "main",
    testCommand: "test",
    archived,
  };
}

describe("Duplicate Project Detection", () => {
  test("Test 1: Exact local project ID collision", () => {
    const existing = createMockProject("converso", "Existing Converso", {
      provider: "github",
      github: { repo: "owner/old" },
    });

    const result = findDuplicateProject(
      [existing],
      "converso",
      "github",
      "",
      "owner/new",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("id_collision");
    expect(result.existingProject?.id).toBe("converso");
  });

  test("Test 2: Same Azure external project, different local ID", () => {
    const existing = createMockProject("converso-prod", "Existing", {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/xynotech", project: "Converso" },
    });

    const result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
  });

  test("Test 3: Azure false positive", () => {
    const existing = createMockProject("another", "Another", {
      provider: "azure",
      azure: {
        orgUrl: "https://dev.azure.com/xynotech",
        project: "AnotherProject",
      },
    });

    const result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/xynotech",
      "Converso",
    );
    expect(result.isDuplicate).toBe(false);
  });

  test("Test 4: Same GitHub repository", () => {
    const existing = createMockProject("example1", "Example 1", {
      provider: "github",
      github: { repo: "owner/example" },
    });

    const result = findDuplicateProject(
      [existing],
      "example2",
      "github",
      "",
      "OWNER/EXAMPLE",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("external_identity");
  });

  test("Test 5: GitHub false positive", () => {
    const existing = createMockProject("example1", "Example 1", {
      provider: "github",
      github: { repo: "owner/example" },
    });

    const result = findDuplicateProject(
      [existing],
      "example2",
      "github",
      "",
      "owner/example-other",
    );
    expect(result.isDuplicate).toBe(false);
  });

  test("Test 6: Archived project", () => {
    const existing = createMockProject(
      "converso",
      "Existing",
      { provider: "azure", azure: { orgUrl: "foo", project: "bar" } },
      true,
    );

    const result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "foo",
      "bar",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.existingProject?.archived).toBe(true);
  });

  test("Test 7: Changing identity clears stale state", () => {
    const existing = createMockProject("converso-prod", "Existing", {
      provider: "azure",
      azure: { orgUrl: "https://dev.azure.com/xynotech", project: "Converso" },
    });

    let result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso",
    );
    expect(result.isDuplicate).toBe(true);

    // Change Azure project
    result = findDuplicateProject(
      [existing],
      "converso",
      "azure",
      "https://dev.azure.com/XynoTech/",
      "converso-new",
    );
    expect(result.isDuplicate).toBe(false);

    // Now test ID collision
    result = findDuplicateProject(
      [existing],
      "converso-prod",
      "github",
      "",
      "owner/repo",
    );
    expect(result.isDuplicate).toBe(true);
    expect(result.type).toBe("id_collision");

    // Change ID
    result = findDuplicateProject(
      [existing],
      "converso-new",
      "github",
      "",
      "owner/repo",
    );
    expect(result.isDuplicate).toBe(false);
  });

  test("Normalize Azure Organization", () => {
    expect(normalizeAzureOrganization("https://dev.azure.com/xynotech/")).toBe(
      "https://dev.azure.com/xynotech",
    );
    expect(normalizeAzureOrganization("dev.azure.com/xynotech")).toBe(
      "https://dev.azure.com/xynotech",
    );
    expect(normalizeAzureOrganization("https://dev.azure.com/XYNOTECH")).toBe(
      "https://dev.azure.com/xynotech",
    );
  });
});
