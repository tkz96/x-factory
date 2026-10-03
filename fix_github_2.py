import re

with open("src/providers/github-module.ts", "r") as f:
    content = f.read()

new_list_repos = """  async listRepositories(
    config: ProviderConfig,
  ): Promise<ProviderRepository[]> {
    const resolved = resolveGitHubConfig(config);
    const headers = makeHeaders(resolved.token);

    const initialUrl = resolved.owner
      ? `https://api.github.com/orgs/${encodeURIComponent(resolved.owner)}/repos?per_page=100&type=all`
      : "https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member";

    let repos: Array<{
      id: number | string;
      name: string;
      clone_url?: string;
      html_url?: string;
      default_branch?: string;
    }> = [];

    let currentUrl: string | null = initialUrl;
    while (currentUrl) {
      let res = await this.fetch(currentUrl, { headers });
      if (res.status === 404 && resolved.owner && currentUrl === initialUrl) {
        currentUrl = `https://api.github.com/users/${encodeURIComponent(resolved.owner)}/repos?per_page=100`;
        res = await this.fetch(currentUrl, { headers });
      }

      if (!res.ok) {
        throw createHttpError(
          `GitHub repository discovery failed with HTTP ${res.status}`,
          res,
        );
      }

      const pageRepos = (await res.json()) as typeof repos;
      repos = repos.concat(pageRepos);

      // Extract next page from Link header if present
      const linkHeader = res.headers.get("link");
      currentUrl = null;
      if (linkHeader) {
        const match = linkHeader.match(/<([^>]+)>;\\s*rel="next"/);
        if (match) {
          currentUrl = match[1] as string;
        }
      }
    }

    return repos.map((repo) => ({
      id: String(repo.id),
      name: repo.name,
      remote: repo.clone_url || repo.html_url || "",
      defaultBranch: repo.default_branch || "main",
      ...(repo.html_url ? { webUrl: repo.html_url } : {}),
    }));
  }"""

# escape the new_list_repos for sub repl
new_list_repos = new_list_repos.replace('\\', '\\\\')

content = re.sub(r'  async listRepositories\([\s\S]*?    \}\)\);\n  \}', new_list_repos, content)

with open("src/providers/github-module.ts", "w") as f:
    f.write(content)
