import { describe, expect, test } from "bun:test";
import { normalizeGitRemoteUrl } from "../src/shared/git-remote.js";

// Literal expectations only: the expected identity is written out by hand,
// never recomputed with the code under test.
describe("normalizeGitRemoteUrl (pure remote identity)", () => {
  const table: Array<[string, string]> = [
    // GitHub: every transport and trailing-slash variant is one identity.
    ["https://github.com/owner/repo", "github:owner/repo"],
    ["https://github.com/owner/repo.git", "github:owner/repo"],
    ["https://github.com/owner/repo/", "github:owner/repo"],
    ["https://github.com/owner/repo.git/", "github:owner/repo"],
    ["git@github.com:owner/repo", "github:owner/repo"],
    ["git@github.com:owner/repo.git", "github:owner/repo"],
    ["ssh://git@github.com/owner/repo.git", "github:owner/repo"],
    ["ssh://git@github.com/owner/repo.git/", "github:owner/repo"],
    ["ssh://git@github.com:22/owner/repo.git/", "github:owner/repo"],
    ["HTTPS://GitHub.com/Owner/Repo.git", "github:owner/repo"],
    ["  https://github.com/owner/repo.git  ", "github:owner/repo"],
    // Generic hosts: scheme, userinfo, port and trailing slash do not matter.
    ["https://gitlab.example.com/group/repo", "gitlab.example.com/group/repo"],
    [
      "https://gitlab.example.com/group/repo.git/",
      "gitlab.example.com/group/repo",
    ],
    ["git@gitlab.example.com:group/repo.git", "gitlab.example.com/group/repo"],
    [
      "ssh://git@gitlab.example.com/group/repo.git/",
      "gitlab.example.com/group/repo",
    ],
    [
      "ssh://git@gitlab.example.com:2222/group/repo.git/",
      "gitlab.example.com/group/repo",
    ],
    [
      "https://gitlab.example.com:8443/group/repo",
      "gitlab.example.com/group/repo",
    ],
    [
      "https://GitLab.Example.com/Group/Repo.git",
      "gitlab.example.com/group/repo",
    ],
    // Azure DevOps: HTTPS, SSH and legacy visualstudio.com forms converge.
    ["https://dev.azure.com/org/project/_git/repo", "azure:org/project/repo"],
    [
      "https://dev.azure.com/org/project/_git/repo.git/",
      "azure:org/project/repo",
    ],
    ["https://dev.azure.com/Org/Project/_git/Repo", "azure:org/project/repo"],
    ["git@ssh.dev.azure.com:v3/org/project/repo", "azure:org/project/repo"],
    [
      "git@ssh.dev.azure.com:v3/org/project/repo.git/",
      "azure:org/project/repo",
    ],
    [
      "ssh://git@ssh.dev.azure.com/v3/org/project/repo",
      "azure:org/project/repo",
    ],
    [
      "https://org.visualstudio.com/project/_git/repo",
      "azure:org/project/repo",
    ],
    // Empty input.
    ["", ""],
  ];

  for (const [input, expected] of table) {
    test(`${JSON.stringify(input)} -> ${JSON.stringify(expected)}`, () => {
      expect(normalizeGitRemoteUrl(input)).toBe(expected);
    });
  }

  test("ssh and trailing-slash remotes equal their HTTPS equivalents", () => {
    expect(normalizeGitRemoteUrl("ssh://git@github.com/owner/repo.git/")).toBe(
      normalizeGitRemoteUrl("https://github.com/owner/repo"),
    );
    expect(
      normalizeGitRemoteUrl("ssh://git@gitlab.example.com:2222/group/repo/"),
    ).toBe(normalizeGitRemoteUrl("https://gitlab.example.com/group/repo"));
  });
});
