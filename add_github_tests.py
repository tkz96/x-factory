import re

with open("test/providers-github.test.ts", "r") as f:
    content = f.read()

new_tests = """  test("findExistingPullRequest throws when both REST and CLI lookup mechanisms fail", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => ({
        command: "gh",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "gh auth error",
        durationMs: 0,
      }),
    };
    const provider = new GitHubProvider(customDeps);

    await expect(
      provider.findExistingPullRequest(
        { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
        { repository: "octocat/Hello-World", sourceBranch: "non-existent" },
      )
    ).rejects.toThrow(/HTTP 500/);
  });

  test("findExistingPullRequest returns null when CLI fallback fails with 'no pull requests found'", async () => {
    const stubFetch: GitHubFetch = async () => {
      return new Response("Internal Server Error", { status: 500 });
    };

    const customDeps: GitHubModuleDeps = {
      fetch: stubFetch,
      execCommand: async () => ({
        command: "gh",
        exitCode: 1,
        passed: false,
        stdout: "",
        stderr: "no pull requests found for branch 'non-existent'",
        durationMs: 0,
      }),
    };
    const provider = new GitHubProvider(customDeps);

    const pr = await provider.findExistingPullRequest(
      { token: "ghp_tok", owner: "octocat", repo: "Hello-World" },
      { repository: "octocat/Hello-World", sourceBranch: "non-existent" },
    );
    expect(pr).toBeNull();
  });\n"""

# Insert right after `expect(pr).toBeNull();\n  });\n`
content = content.replace("expect(pr).toBeNull();\n  });\n", "expect(pr).toBeNull();\n  });\n\n" + new_tests)

with open("test/providers-github.test.ts", "w") as f:
    f.write(content)
