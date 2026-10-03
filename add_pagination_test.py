import re

with open("test/providers-github.test.ts", "r") as f:
    content = f.read()

new_test = """  test("listRepositories paginates to retrieve all discoverable repositories", async () => {
    let callCount = 0;
    const stubFetch: GitHubFetch = async (url) => {
      callCount++;
      if (callCount === 1) {
        return new Response(
          JSON.stringify([{ id: 1, name: "repo-1" }]),
          {
            status: 200,
            headers: {
              link: '<https://api.github.com/orgs/octocat/repos?page=2>; rel="next"',
            }
          }
        );
      } else {
        return new Response(
          JSON.stringify([{ id: 2, name: "repo-2" }]),
          { status: 200 }
        );
      }
    };

    const provider = new GitHubProvider({
      ...defaultGitHubDeps,
      fetch: stubFetch,
    });
    const repos = await provider.listRepositories({
      token: "ghp_tok",
      owner: "octocat",
    });

    expect(callCount).toBe(2);
    expect(repos).toHaveLength(2);
    expect(repos[0]?.name).toBe("repo-1");
    expect(repos[1]?.name).toBe("repo-2");
  });\n\n"""

# insert before listTickets
content = content.replace('  test("listTickets queries issues', new_test + '  test("listTickets queries issues')

with open("test/providers-github.test.ts", "w") as f:
    f.write(content)

