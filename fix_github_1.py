import re

with open("src/providers/github-module.ts", "r") as f:
    content = f.read()

# Fix 1: findExistingPullRequest semantics
new_find = """  async findExistingPullRequest(
    config: ProviderConfig,
    input: FindPullRequestInput,
  ): Promise<ProviderPullRequest | null> {
    const { owner, repo, token } = resolveGitHubConfig(config);
    if (!owner || !repo) {
      return null;
    }

    let lookupError: unknown = null;
    if (token) {
      try {
        const res = await this.fetch(
          `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls?head=${encodeURIComponent(`${owner}:${input.sourceBranch}`)}&state=all`,
          { headers: makeHeaders(token) },
        );

        if (res.ok) {
          const pulls = (await res.json()) as Array<{
            html_url: string;
            state?: string;
            head?: { ref?: string; sha?: string };
            base?: { ref?: string };
          }>;
          const match = pulls.find((p) => p.head?.ref === input.sourceBranch);
          if (match) {
            return {
              url: match.html_url,
              ...(match.state ? { status: match.state } : {}),
              sourceBranch: match.head?.ref ?? input.sourceBranch,
              ...(match.base?.ref ? { targetBranch: match.base.ref } : {}),
              ...(match.head?.sha
                ? { lastMergeSourceCommit: match.head.sha }
                : {}),
            };
          }
          return null; // successful lookup + no match -> null
        }
        lookupError = createHttpError(`GitHub PR lookup failed with HTTP ${res.status}`, res);
      } catch (err) {
        lookupError = err;
      }
    } else {
      lookupError = new Error("No GitHub token configured for REST API.");
    }

    // Fallback: gh CLI
    const cliResult = await this.deps.execCommand("gh", [
      "pr",
      "view",
      input.sourceBranch,
      "--repo",
      `${owner}/${repo}`,
      "--json",
      "url,headRefName,headRefOid,baseRefName,state",
    ]);

    if (cliResult.passed && cliResult.stdout) {
      try {
        const data = JSON.parse(cliResult.stdout) as {
          url: string;
          state?: string;
          headRefName?: string;
          headRefOid?: string;
          baseRefName?: string;
        };
        if (data?.url) {
          return {
            url: data.url,
            ...(data.state ? { status: data.state } : {}),
            sourceBranch: data.headRefName ?? input.sourceBranch,
            ...(data.baseRefName ? { targetBranch: data.baseRefName } : {}),
            ...(data.headRefOid
              ? { lastMergeSourceCommit: data.headRefOid }
              : {}),
          };
        }
      } catch {
        // ignore JSON parse failure
      }
    }
    
    // If CLI failed with "no pull requests found", return null!
    if (!cliResult.passed && cliResult.stderr && cliResult.stderr.includes("no pull requests found")) {
        return null;
    }

    // Both failed, throw!
    if (lookupError) {
        throw lookupError;
    }
    throw new Error(`GitHub PR lookup failed. CLI stderr: ${cliResult.stderr}`);
  }"""

# Need to replace the whole method!
content = re.sub(r'  async findExistingPullRequest\([\s\S]*?    return null;\n  \}', new_find, content)

with open("src/providers/github-module.ts", "w") as f:
    f.write(content)
